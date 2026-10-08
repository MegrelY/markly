// Markly: a small native shell (Tauri + the system webview: WebView2 on Windows, WKWebView on
// macOS, WebKitGTK on Linux) around a Markdown renderer.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_window_state::StateFlags;

const MAX_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Default)]
struct AppState {
    /// File to show at start-up (command line, or a macOS "open document" event).
    initial: Mutex<Option<String>>,
    /// Set once the page has asked for `initial`; later open requests are sent as events.
    frontend_ready: AtomicBool,
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Watches the folder shown in the folder browser (non-recursive).
    dir_watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Serialize)]
struct Doc {
    path: String,
    name: String,
    dir: String,
    content: String,
}

fn decode(bytes: Vec<u8>) -> String {
    // UTF-16 (with BOM) is common for files produced by Windows tools.
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let u: Vec<u16> = bytes[2..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        return String::from_utf16_lossy(&u);
    }
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let u: Vec<u16> = bytes[2..].chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        return String::from_utf16_lossy(&u);
    }
    let s = match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
    };
    s.strip_prefix('\u{feff}').map(str::to_owned).unwrap_or(s)
}

#[tauri::command]
async fn read_markdown(path: String) -> Result<Doc, String> {
    let p = PathBuf::from(&path);
    let p = dunce::canonicalize(&p).unwrap_or(p);
    let meta = std::fs::metadata(&p).map_err(|e| format!("Could not open {}: {}", p.display(), e))?;
    if meta.is_dir() {
        return Err(format!("{} is a folder, not a file", p.display()));
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("{} is too large to display ({} MB)", p.display(), meta.len() / 1_048_576));
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("Could not open {}: {}", p.display(), e))?;
    Ok(Doc {
        name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        dir: p.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
        path: p.to_string_lossy().into_owned(),
        content: decode(bytes),
    })
}

/// Fallback for local images if the asset protocol refuses a path: returns a data: URL.
#[tauri::command]
async fn read_image(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let ext = p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return Err("not an image".into()),
    };
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > 32 * 1024 * 1024 {
        return Err("image too large".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    Ok(format!("data:{};base64,{}", mime, base64_encode(&bytes)))
}

fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

#[tauri::command]
fn initial_file(state: State<'_, AppState>) -> Option<String> {
    let initial = state.initial.lock().ok()?;
    state.frontend_ready.store(true, Ordering::SeqCst);
    initial.clone()
}

/// Opens `path` in the window: before the page is ready it becomes the start-up file, afterwards
/// it is delivered as an `open-file` event (macOS sends these when a document is double-clicked).
#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
fn open_document(app: &AppHandle, path: String) {
    let state = app.state::<AppState>();
    let Ok(mut initial) = state.initial.lock() else { return };
    if state.frontend_ready.load(Ordering::SeqCst) {
        drop(initial);
        let _ = app.emit("open-file", &path);
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    } else {
        *initial = Some(path);
    }
}

fn same_name(a: &std::ffi::OsStr, b: &std::ffi::OsStr) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy())
    } else {
        a == b
    }
}

/// Watch the folder containing `path` (editors often save via rename) and emit
/// `file-changed` whenever the file itself is written, created or renamed into place.
#[tauri::command]
fn watch_file(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let dir = target.parent().map(Path::to_path_buf).ok_or("no parent folder")?;
    let name = target.file_name().map(|n| n.to_os_string()).ok_or("no file name")?;
    let emit_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if !matches!(ev.kind, EventKind::Modify(_) | EventKind::Create(_) | EventKind::Any) {
            return;
        }
        if ev.paths.iter().any(|p| p.file_name().is_some_and(|n| same_name(n, &name))) {
            let _ = app.emit("file-changed", &emit_path);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    if let Ok(mut slot) = state.watcher.lock() {
        *slot = Some(watcher); // dropping the previous watcher stops it
    }
    Ok(())
}

// ---------------------------------------------------------------- folder browser

/// Folders listed beyond this many entries are cut off (the page says so).
const MAX_ENTRIES: usize = 5000;

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    dir: bool,
}

#[derive(Serialize)]
struct Crumb {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct Listing {
    /// Canonical folder path ("" is the list of drives on Windows).
    path: String,
    /// Folder that "Up" goes to; None at the top.
    parent: Option<String>,
    crumbs: Vec<Crumb>,
    entries: Vec<Entry>,
    truncated: bool,
}

#[derive(Serialize)]
struct ListError {
    /// "denied", "notfound" or "other"
    kind: &'static str,
    message: String,
}

fn list_error(e: std::io::Error) -> ListError {
    let kind = match e.kind() {
        std::io::ErrorKind::PermissionDenied => "denied",
        std::io::ErrorKind::NotFound => "notfound",
        _ => "other",
    };
    ListError { kind, message: e.to_string() }
}

/// Hidden entries are never listed: dot-files everywhere, plus the hidden/system attributes on Windows.
fn is_hidden(name: &str, _entry: &std::fs::DirEntry) -> bool {
    if name.starts_with('.') {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN: u32 = 0x2;
        const SYSTEM: u32 = 0x4;
        if let Ok(m) = _entry.metadata() {
            return m.file_attributes() & (HIDDEN | SYSTEM) != 0;
        }
    }
    false
}

fn crumbs_for(p: &Path) -> Vec<Crumb> {
    let mut out: Vec<Crumb> = p
        .ancestors()
        .map(|a| Crumb {
            name: a
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| a.to_string_lossy().trim_end_matches(['\\', '/']).to_string()),
            path: a.to_string_lossy().into_owned(),
        })
        .collect();
    out.reverse();
    if let Some(root) = out.first_mut() {
        if root.name.is_empty() {
            root.name = root.path.clone(); // "/" on Linux/macOS
        }
    }
    if cfg!(windows) {
        out.insert(0, Crumb { name: "This PC".into(), path: String::new() });
    }
    out
}

#[cfg(windows)]
fn list_drives() -> Listing {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetLogicalDrives() -> u32;
    }
    // SAFETY: GetLogicalDrives takes no arguments and only returns a bit mask.
    let mask = unsafe { GetLogicalDrives() };
    let entries = (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| {
            let letter = (b'A' + i) as char;
            Entry { name: format!("{letter}:"), path: format!("{letter}:\\"), dir: true }
        })
        .collect();
    Listing {
        path: String::new(),
        parent: None,
        crumbs: vec![Crumb { name: "This PC".into(), path: String::new() }],
        entries,
        truncated: false,
    }
}

/// Lists a folder for the folder browser: visible entries only, unsorted (the page sorts).
#[tauri::command]
async fn list_dir(path: String) -> Result<Listing, ListError> {
    #[cfg(windows)]
    if path.is_empty() {
        return Ok(list_drives());
    }
    let p = match path.as_str() {
        "" => PathBuf::from("/"),
        // "~": the user's home folder (start point when no document is open)
        "~" => std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/")),
        _ => PathBuf::from(&path),
    };
    let p = dunce::canonicalize(&p).map_err(list_error)?;
    let meta = std::fs::metadata(&p).map_err(list_error)?;
    if !meta.is_dir() {
        return Err(ListError { kind: "other", message: format!("{} is not a folder", p.display()) });
    }
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in std::fs::read_dir(&p).map_err(list_error)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_hidden(&name, &entry) {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        // Follow symlinks to decide folder vs file; broken links count as files.
        let dir = if ft.is_symlink() { std::fs::metadata(entry.path()).is_ok_and(|m| m.is_dir()) } else { ft.is_dir() };
        if entries.len() == MAX_ENTRIES {
            truncated = true;
            break;
        }
        entries.push(Entry { name, path: entry.path().to_string_lossy().into_owned(), dir });
    }
    let parent = match p.parent() {
        Some(parent) => Some(parent.to_string_lossy().into_owned()),
        None if cfg!(windows) => Some(String::new()), // drive root -> list of drives
        None => None,
    };
    Ok(Listing { path: p.to_string_lossy().into_owned(), parent, crumbs: crumbs_for(&p), entries, truncated })
}

/// Watches the folder shown in the folder browser and emits `dir-changed` when its entries change.
/// `None` (panel closed) stops watching.
#[tauri::command]
fn watch_dir(app: AppHandle, state: State<'_, AppState>, path: Option<String>) -> Result<(), String> {
    let mut slot = state.dir_watcher.lock().map_err(|e| e.to_string())?;
    *slot = None;
    let Some(path) = path.filter(|p| !p.is_empty()) else { return Ok(()) };
    let emit_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if matches!(ev.kind, EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(notify::event::ModifyKind::Name(_)) | EventKind::Any) {
            let _ = app.emit("dir-changed", &emit_path);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(Path::new(&path), RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    *slot = Some(watcher);
    Ok(())
}

fn initial_from_args() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned())
        .find(|a| !a.starts_with("--") && !a.is_empty())
        .map(|a| {
            let p = PathBuf::from(&a);
            let abs = if p.is_absolute() { p } else { std::env::current_dir().map(|d| d.join(&p)).unwrap_or(p) };
            abs.to_string_lossy().into_owned()
        })
}

fn main() {
    let state = AppState { initial: Mutex::new(initial_from_args()), ..Default::default() };

    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![read_markdown, read_image, initial_file, watch_file, list_dir, watch_dir])
        .setup(|app| {
            // The page shows the window after its first paint (no white flash);
            // this is a safety net in case that never happens.
            if let Some(win) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1500));
                    if !win.is_visible().unwrap_or(true) {
                        let _ = win.show();
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Markly")
        .run(|_app, _event| {
            // macOS delivers Finder double-clicks / "Open With" / `open -a` as an event, both at
            // launch and while running (Windows and Linux pass the path on the command line).
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = &_event {
                if let Some(path) = urls.iter().find_map(|u| u.to_file_path().ok()) {
                    open_document(_app, path.to_string_lossy().into_owned());
                }
            }
        });
}
