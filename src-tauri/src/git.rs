//! Read-only file history through the `git` command-line tool.
//!
//! Every call runs `git` directly (no shell) with an argument list, with the pager, external diff
//! tools, text conversion filters and fsmonitor hooks turned off, `GIT_OPTIONAL_LOCKS=0` (so even
//! `git status` never rewrites the index), a timeout and an output limit. Only commands that read
//! the repository are used: `ls-files`, `log`, `status`, `show`, `diff` and `cat-file`.

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

const TIMEOUT: Duration = Duration::from_secs(20);
/// Diffs larger than this are cut off (the page says so).
const MAX_DIFF: usize = 4 * 1024 * 1024;
const MAX_LOG: usize = 16 * 1024 * 1024;
const MAX_FILE: usize = 64 * 1024 * 1024;
/// At most this many commits are listed.
pub const MAX_COMMITS: usize = 2000;

#[derive(Serialize, Debug)]
pub struct GitError {
    /// "nogit" (git is not installed), "timeout", "notrepo" or "git" (git reported an error)
    pub kind: &'static str,
    pub message: String,
}

fn err(kind: &'static str, message: impl Into<String>) -> GitError {
    GitError { kind, message: message.into() }
}

struct Output {
    stdout: Vec<u8>,
    truncated: bool,
}

/// Runs `git <args>` in `cwd` and returns its standard output (at most `limit` bytes).
fn run(cwd: &Path, args: &[&OsStr], limit: usize) -> Result<Output, GitError> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        .args(["--no-pager", "--literal-pathspecs"])
        .args(["-c", "core.quotepath=off", "-c", "core.fsmonitor=false", "-c", "color.ui=never", "-c", "log.showSignature=false"])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000; // no console window flashes up
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            err("nogit", "Git isn't installed, or it isn't on the PATH.")
        } else {
            err("git", format!("Couldn't run git: {e}"))
        }
    })?;
    let mut stdout = child.stdout.take().expect("piped");
    let mut stderr = child.stderr.take().expect("piped");
    // Read both pipes on threads so a full pipe never blocks git; stop reading past the limit
    // (git then exits on the closed pipe).
    let out_t = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 64 * 1024];
        let mut truncated = false;
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if buf.len() + n > limit {
                        buf.extend_from_slice(&chunk[..limit - buf.len()]);
                        truncated = true;
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
            }
        }
        (buf, truncated)
    });
    let err_t = std::thread::spawn(move || {
        let mut s = Vec::new();
        let _ = (&mut stderr).take(64 * 1024).read_to_end(&mut s);
        s
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if start.elapsed() > TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(err("timeout", "Git took too long to answer."));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(3)),
            Err(e) => return Err(err("git", e.to_string())),
        }
    };
    let (stdout, truncated) = out_t.join().unwrap_or_default();
    let stderr = err_t.join().unwrap_or_default();
    if !status.success() && !truncated {
        let msg = String::from_utf8_lossy(&stderr);
        let msg = msg.lines().find(|l| !l.trim().is_empty()).unwrap_or("git failed").trim();
        let msg = msg.strip_prefix("fatal: ").unwrap_or(msg);
        return Err(err("git", msg.to_string()));
    }
    Ok(Output { stdout, truncated })
}

fn os(s: &str) -> &OsStr {
    OsStr::new(s)
}

/// Commit ids from the page are checked before they reach git, so they can't be read as options.
fn check_rev(rev: &str) -> Result<&str, GitError> {
    if (4..=64).contains(&rev.len()) && rev.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(rev)
    } else {
        Err(err("git", format!("Not a commit id: {rev}")))
    }
}

/// Repository-relative paths (as git prints them, with `/`) must stay inside the repository.
fn check_rel(rel: &str) -> Result<&str, GitError> {
    if rel.is_empty() || rel.starts_with('/') || rel.contains('\0') || rel.split('/').any(|c| c == "..") {
        return Err(err("git", format!("Bad path: {rel}")));
    }
    Ok(rel)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Info {
    /// Work tree root (native separators).
    pub root: String,
    /// File path relative to `root`, with `/` (git's form).
    pub rel: String,
    /// False when git itself is missing; the page then explains that.
    pub available: bool,
}

/// Cheap check: is `path` tracked in a git work tree? First looks for a `.git` entry in the
/// file's folder and its parents (no process at all for files outside a repository), then asks
/// `git ls-files` once.
pub fn info(path: &str) -> Result<Option<Info>, GitError> {
    let p = dunce::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
    let Some(dir) = p.parent() else { return Ok(None) };
    let Some(name) = p.file_name() else { return Ok(None) };
    let Some(root) = dir.ancestors().find(|a| a.join(".git").exists()) else { return Ok(None) };
    let mut spec = OsString::from("./");
    spec.push(name);
    match run(dir, &[os("ls-files"), os("--full-name"), os("-z"), os("--error-unmatch"), os("--"), &spec], 64 * 1024) {
        Ok(o) => {
            let rel = String::from_utf8_lossy(&o.stdout);
            let rel = rel.split('\0').next().unwrap_or_default().to_string();
            if rel.is_empty() {
                return Ok(None);
            }
            // The work tree root is the folder the relative path is relative to.
            let depth = rel.matches('/').count();
            let top = p.ancestors().nth(depth + 1).unwrap_or(root);
            Ok(Some(Info { root: top.to_string_lossy().into_owned(), rel, available: true }))
        }
        Err(e) if e.kind == "nogit" => {
            Ok(Some(Info { root: root.to_string_lossy().into_owned(), rel: String::new(), available: false }))
        }
        Err(_) => Ok(None), // untracked, ignored, or not really a repository
    }
}

#[derive(Serialize, Debug, Clone)]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub email: String,
    /// Author date, seconds since 1970 (UTC).
    pub time: i64,
    pub subject: String,
    /// The file's path in this commit, and its earlier path if the commit renamed it.
    pub path: String,
    pub old_path: Option<String>,
    /// "A", "M", "D", "R", ... ("" for merges, which list no changes)
    pub status: String,
}

#[derive(Serialize, Debug)]
pub struct Log {
    pub commits: Vec<Commit>,
    pub truncated: bool,
    /// Staged / unstaged changes to the file in the working copy.
    pub staged: bool,
    pub unstaged: bool,
}

pub fn parse_log(raw: &[u8], current: &str) -> Vec<Commit> {
    let text = String::from_utf8_lossy(raw);
    let mut out: Vec<Commit> = Vec::new();
    let mut path = current.to_string();
    for rec in text.split('\u{1e}').filter(|r| !r.is_empty()) {
        let (head, rest) = rec.split_once('\0').unwrap_or((rec, ""));
        let f: Vec<&str> = head.splitn(6, '\u{1f}').collect();
        if f.len() < 6 {
            continue;
        }
        let parts: Vec<&str> = rest.trim_start_matches('\n').split('\0').filter(|s| !s.is_empty()).collect();
        let (status, old_path, new_path) = match parts.as_slice() {
            [st, old, new, ..] if st.starts_with('R') || st.starts_with('C') => (st[..1].to_string(), Some(old.to_string()), new.to_string()),
            [st, p, ..] => (st[..1].to_string(), None, p.to_string()),
            _ => (String::new(), None, path.clone()),
        };
        // Older commits (further down) see the file under the name it had before a rename.
        path = old_path.clone().unwrap_or_else(|| new_path.clone());
        out.push(Commit {
            hash: f[0].into(),
            short: f[1].into(),
            author: f[2].into(),
            email: f[3].into(),
            time: f[4].parse().unwrap_or(0),
            subject: f[5].into(),
            path: new_path,
            old_path,
            status,
        });
    }
    out
}

pub fn log(root: &str, rel: &str) -> Result<Log, GitError> {
    let root = Path::new(root);
    let rel = check_rel(rel)?;
    let n = format!("-n{}", MAX_COMMITS + 1);
    let o = run(
        root,
        &[
            os("log"), os("--follow"), os("-z"), os("-M"), os("--name-status"), os("--no-color"), os(&n),
            os("--format=%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s"), os("--"), os(rel),
        ],
        MAX_LOG,
    );
    let mut commits = match o {
        Ok(o) => parse_log(&o.stdout, rel),
        // A repository without commits yet has no history (and git log fails on it).
        Err(e) if e.message.contains("does not have any commits") || e.message.contains("bad default revision") => Vec::new(),
        Err(e) => return Err(e),
    };
    let truncated = commits.len() > MAX_COMMITS;
    commits.truncate(MAX_COMMITS);
    let st = run(root, &[os("status"), os("--porcelain=v1"), os("-z"), os("--untracked-files=no"), os("--no-renames"), os("--"), os(rel)], 64 * 1024)?;
    let st = String::from_utf8_lossy(&st.stdout);
    let (mut staged, mut unstaged) = (false, false);
    for e in st.split('\0').filter(|e| e.len() > 3) {
        let b = e.as_bytes();
        staged |= b[0] != b' ' && b[0] != b'?';
        unstaged |= b[1] != b' ' && b[1] != b'?';
    }
    Ok(Log { commits, truncated, staged, unstaged })
}

#[derive(Serialize, Debug)]
pub struct Diff {
    /// Unified diff text as git prints it (empty when nothing changed).
    pub patch: String,
    pub truncated: bool,
}

/// The diff of the file:
/// - `rev` only: what that commit changed (against its first parent);
/// - `base` and `rev`: between two commits;
/// - neither: the working copy (staged and unstaged) against HEAD.
///
/// `paths` are the file's repository-relative path(s); pass the old and new path for a rename.
pub fn diff(root: &str, rev: Option<&str>, base: Option<&str>, paths: &[String]) -> Result<Diff, GitError> {
    let root = Path::new(root);
    let mut args: Vec<&OsStr> = Vec::new();
    let (rev, base) = (rev.map(check_rev).transpose()?, base.map(check_rev).transpose()?);
    let common = [os("-M"), os("--no-color"), os("--no-ext-diff"), os("--no-textconv"), os("-U3")];
    match (base, rev) {
        (None, Some(r)) => {
            args.extend([os("show"), os("--format="), os("--diff-merges=first-parent")]);
            args.extend(common);
            args.push(os(r));
        }
        (Some(b), Some(r)) => {
            args.push(os("diff"));
            args.extend(common);
            args.extend([os(b), os(r)]);
        }
        (_, None) => {
            args.push(os("diff"));
            args.extend(common);
            args.push(os("HEAD"));
        }
    }
    args.push(os("--"));
    for p in paths {
        args.push(os(check_rel(p)?));
    }
    let o = run(root, &args, MAX_DIFF)?;
    Ok(Diff { patch: String::from_utf8_lossy(&o.stdout).into_owned(), truncated: o.truncated })
}

/// The file's content at `rev` (raw bytes; no filters run).
pub fn show_file(root: &str, rev: &str, rel: &str) -> Result<Vec<u8>, GitError> {
    let spec = format!("{}:{}", check_rev(rev)?, check_rel(rel)?);
    let o = run(Path::new(root), &[os("cat-file"), os("blob"), os(&spec)], MAX_FILE)?;
    if o.truncated {
        return Err(err("git", "This version of the file is too large to display."));
    }
    Ok(o.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(dir: &Path, args: &[&str], date: &str) {
        let ok = Command::new("git")
            .current_dir(dir)
            .args(["-c", "user.name=Ada Lovelace", "-c", "user.email=ada@example.com", "-c", "commit.gpgsign=false"])
            .args(args)
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date)
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?}");
    }

    /// A repository with an add, an edit, a rename into a folder with spaces/Unicode, and an edit.
    fn fixture() -> (tempdir::Dir, PathBuf) {
        let d = tempdir::Dir::new();
        let r = d.0.clone();
        sh(&r, &["init", "-q", "-b", "main"], "2026-01-01T10:00:00Z");
        std::fs::write(r.join("notes.md"), "# Notes\n\nfirst line\n").unwrap();
        sh(&r, &["add", "."], "2026-01-01T10:00:00Z");
        sh(&r, &["commit", "-qm", "Add notes"], "2026-01-01T10:00:00Z");
        std::fs::write(r.join("notes.md"), "# Notes\n\nfirst line, edited\nsecond\n").unwrap();
        sh(&r, &["commit", "-qam", "Edit notes"], "2026-01-02T10:00:00Z");
        std::fs::create_dir(r.join("my docs")).unwrap();
        sh(&r, &["mv", "notes.md", "my docs/nötes ü.md"], "2026-01-03T10:00:00Z");
        sh(&r, &["commit", "-qm", "Move notes"], "2026-01-03T10:00:00Z");
        let f = r.join("my docs").join("nötes ü.md");
        std::fs::write(&f, "# Notes\n\nfirst line, edited\nsecond\nthird\n").unwrap();
        sh(&r, &["commit", "-qam", "Add third"], "2026-01-04T10:00:00Z");
        (d, f)
    }

    mod tempdir {
        pub struct Dir(pub std::path::PathBuf);
        impl Dir {
            pub fn new() -> Self {
                let p = std::env::temp_dir().join(format!("markly-git-{}-{:?}", std::process::id(), std::thread::current().id()));
                let _ = std::fs::remove_dir_all(&p);
                std::fs::create_dir_all(&p).unwrap();
                Dir(dunce::canonicalize(p).unwrap())
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn history_follows_renames() {
        let (d, f) = fixture();
        let i = info(f.to_str().unwrap()).unwrap().unwrap();
        assert_eq!(i.rel, "my docs/nötes ü.md");
        assert_eq!(Path::new(&i.root), d.0.as_path());
        let l = log(&i.root, &i.rel).unwrap();
        let subjects: Vec<_> = l.commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["Add third", "Move notes", "Edit notes", "Add notes"]);
        assert_eq!(l.commits[1].status, "R");
        assert_eq!(l.commits[1].old_path.as_deref(), Some("notes.md"));
        assert_eq!(l.commits[2].path, "notes.md");
        assert_eq!(l.commits[3].status, "A");
        assert_eq!(l.commits[0].author, "Ada Lovelace");
        assert!(!l.staged && !l.unstaged);

        let edit = diff(&i.root, Some(&l.commits[2].hash), None, &[l.commits[2].path.clone()]).unwrap();
        assert!(edit.patch.contains("-first line\n+first line, edited\n+second\n"), "{}", edit.patch);
        let mv = &l.commits[1];
        let rd = diff(&i.root, Some(&mv.hash), None, &[mv.old_path.clone().unwrap(), mv.path.clone()]).unwrap();
        assert!(rd.patch.contains("rename from notes.md") && rd.patch.contains("rename to my docs/nötes ü.md"), "{}", rd.patch);
        let root_commit = diff(&i.root, Some(&l.commits[3].hash), None, &["notes.md".into()]).unwrap();
        assert!(root_commit.patch.contains("new file mode"));
        let two = diff(&i.root, Some(&l.commits[0].hash), Some(&l.commits[3].hash), &["notes.md".into(), i.rel.clone()]).unwrap();
        assert!(two.patch.contains("+third"));

        let old = show_file(&i.root, &l.commits[3].hash, "notes.md").unwrap();
        assert_eq!(old, b"# Notes\n\nfirst line\n");

        // Working-copy changes show up, and nothing about the repository is written.
        let index = std::fs::read(d.0.join(".git/index")).unwrap();
        std::fs::write(&f, "# Notes\n\nchanged\n").unwrap();
        let l = log(&i.root, &i.rel).unwrap();
        assert!(l.unstaged && !l.staged);
        assert!(diff(&i.root, None, None, &[i.rel.clone()]).unwrap().patch.contains("+changed"));
        assert_eq!(std::fs::read(d.0.join(".git/index")).unwrap(), index);
    }

    #[test]
    fn untracked_and_outside() {
        let (d, _f) = fixture();
        let u = d.0.join("untracked.md");
        std::fs::write(&u, "x").unwrap();
        assert_eq!(info(u.to_str().unwrap()).unwrap(), None);
        let outside = std::env::temp_dir().join("markly-not-a-repo.md");
        std::fs::write(&outside, "x").unwrap();
        // (the temp folder is not inside a repository on the build machines)
        assert_eq!(info(outside.to_str().unwrap()).unwrap(), None);
    }

    #[test]
    fn rejects_bad_input() {
        assert!(check_rev("--output=x").is_err());
        assert!(check_rev("HEAD").is_err());
        assert!(check_rel("../etc/passwd").is_err());
        assert!(check_rel("/abs").is_err());
        assert!(check_rel("a/b.md").is_ok());
    }
}
