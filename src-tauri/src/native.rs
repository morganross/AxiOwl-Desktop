use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent,
};

use crate::{commands, paths};

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowState {
    x: Option<i32>,
    y: Option<i32>,
    width: Option<u32>,
    height: Option<u32>,
    is_maximized: Option<bool>,
}

const MIN_WINDOW_WIDTH: u32 = 320;
const MIN_WINDOW_HEIGHT: u32 = 200;
const INVALID_MINIMIZED_COORDINATE: i32 = -10000;

pub fn path_from_args(args: &[String]) -> Option<String> {
    paths::path_from_args(args).map(|path| path.to_string_lossy().to_string())
}

pub fn setup_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let new_workspace = MenuItemBuilder::with_id("new-workspace", "New Workspace")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let save_file = MenuItemBuilder::with_id("save-file", "Save File")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let exit = MenuItemBuilder::with_id("exit", "Exit").build(app)?;
    let toggle_sidebar = MenuItemBuilder::with_id("toggle-sidebar", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let toggle_editor = MenuItemBuilder::with_id("toggle-editor", "Toggle Editor")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let about = MenuItemBuilder::with_id("about-axiowl", "About AxiOwl").build(app)?;

    let file = SubmenuBuilder::new(app, "File")
        .items(&[
            &new_workspace,
            &save_file,
            &PredefinedMenuItem::separator(app)?,
            &exit,
        ])
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .items(&[&toggle_sidebar, &toggle_editor])
        .build()?;
    let about_menu = SubmenuBuilder::new(app, "About").items(&[&about]).build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&file, &view, &about_menu])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "new-workspace" => commands::emit_menu_action(app, "new-workspace"),
        "save-file" => commands::emit_menu_action(app, "save-file"),
        "toggle-sidebar" => commands::emit_menu_action(app, "toggle-sidebar"),
        "toggle-editor" => commands::emit_menu_action(app, "toggle-editor"),
        "about-axiowl" => commands::emit_menu_action(app, "about-axiowl"),
        "exit" => app.exit(0),
        _ => {}
    });
    Ok(())
}

pub fn restore_window_state(window: &WebviewWindow, codex_dir: &Path) {
    let path = window_state_path(codex_dir);
    let Ok(raw) = fs::read_to_string(path) else {
        return;
    };
    let Ok(state) = serde_json::from_str::<WindowState>(&raw) else {
        return;
    };
    if !is_plausible_window_state(&state) {
        return;
    }

    if let (Some(width), Some(height)) = (state.width, state.height) {
        let _ = window.set_size(PhysicalSize { width, height });
    }
    if let (Some(x), Some(y)) = (state.x, state.y) {
        let _ = window.set_position(PhysicalPosition { x, y });
    }
    if state.is_maximized.unwrap_or(false) {
        let _ = window.maximize();
    }
}

pub fn setup_window_state_listener(window: &WebviewWindow, codex_dir: PathBuf) {
    let window = window.clone();
    let save_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            save_window_state(&save_window, &codex_dir);
        }
        WindowEvent::CloseRequested { .. } => {
            save_window_state(&save_window, &codex_dir);
        }
        _ => {}
    });
}

fn save_window_state(window: &WebviewWindow, codex_dir: &Path) {
    let path = window_state_path(codex_dir);
    if window.is_minimized().unwrap_or(false) {
        return;
    }

    let is_maximized = window.is_maximized().unwrap_or(false);
    let position = window.outer_position().ok();
    let size = window.outer_size().ok();
    let state = WindowState {
        x: position.map(|pos| pos.x),
        y: position.map(|pos| pos.y),
        width: size.map(|size| size.width),
        height: size.map(|size| size.height),
        is_maximized: Some(is_maximized),
    };
    if !is_plausible_window_state(&state) {
        return;
    }

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string(&state) {
        let _ = fs::write(path, raw);
    }
}

fn window_state_path(codex_dir: &Path) -> PathBuf {
    codex_dir.join("window_state.json")
}

fn is_plausible_window_state(state: &WindowState) -> bool {
    let position_is_plausible = match (state.x, state.y) {
        (Some(x), Some(y)) => x > INVALID_MINIMIZED_COORDINATE && y > INVALID_MINIMIZED_COORDINATE,
        _ => true,
    };
    let size_is_plausible = match (state.width, state.height) {
        (Some(width), Some(height)) => width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT,
        _ => true,
    };

    position_is_plausible && size_is_plausible
}

pub fn register_context_menu_if_packaged() {
    if cfg!(debug_assertions) {
        return;
    }
    if let Err(err) = register_context_menu() {
        eprintln!("[AxiOwl] Failed to register context menu: {err}");
    }
}

#[cfg(windows)]
fn register_context_menu() -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let exec_path = std::env::current_exe()
        .map_err(|err| format!("Could not resolve current executable: {err}"))?
        .to_string_lossy()
        .to_string();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let associations = [
        (r"Software\Classes\*\shell\Open in AxiOwl", "\"%1\""),
        (r"Software\Classes\Directory\shell\Open in AxiOwl", "\"%1\""),
        (
            r"Software\Classes\Directory\Background\shell\Open in AxiOwl",
            "\"%V\"",
        ),
    ];

    for (key_path, target_arg) in associations {
        let (key, _) = hkcu
            .create_subkey(key_path)
            .map_err(|err| format!("Could not create registry key '{key_path}': {err}"))?;
        key.set_value("", &"Open in AxiOwl")
            .map_err(|err| format!("Could not write registry label: {err}"))?;
        key.set_value("Icon", &format!("\"{}\",0", exec_path))
            .map_err(|err| format!("Could not write registry icon: {err}"))?;
        let (cmd, _) = key
            .create_subkey("command")
            .map_err(|err| format!("Could not create registry command key: {err}"))?;
        cmd.set_value("", &format!("\"{}\" {}", exec_path, target_arg))
            .map_err(|err| format!("Could not write registry command: {err}"))?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn register_context_menu() -> Result<(), String> {
    Ok(())
}

pub fn emit_open_path(app: &tauri::AppHandle, target: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("open-path", target.to_string());
    } else {
        let _ = app.emit("open-path", target.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::{is_plausible_window_state, WindowState};

    #[test]
    fn rejects_minimized_window_state_coordinates() {
        let state = WindowState {
            x: Some(-32000),
            y: Some(-32000),
            width: Some(176),
            height: Some(87),
            is_maximized: Some(false),
        };
        assert!(!is_plausible_window_state(&state));
    }

    #[test]
    fn accepts_normal_window_state() {
        let state = WindowState {
            x: Some(120),
            y: Some(80),
            width: Some(1280),
            height: Some(900),
            is_maximized: Some(false),
        };
        assert!(is_plausible_window_state(&state));
    }
}
