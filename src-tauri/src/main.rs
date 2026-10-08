// Markly: a small native shell (Tauri + system WebView2) around a Markdown renderer.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_window_state::StateFlags;

const MAX_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Default)]
struct AppState {
    initial: Mutex<Option<String>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
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
    state.initial.lock().ok()?.clone()
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
        .invoke_handler(tauri::generate_handler![read_markdown, read_image, initial_file, watch_file])
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
        .run(tauri::generate_context!())
        .expect("error while running Markly");
}
