mod app_state;
mod auth;
mod codex_runtime;
mod commands;
mod dto;
mod events;
mod files;
mod logging;
mod native;
mod paths;
mod process;
mod quota;
mod sessions;
mod workspace;
mod workspace_store;

use app_state::AppState;
use tauri::Manager;

pub fn run() {
    let state = AppState::initialize()
        .unwrap_or_else(|err| panic!("[AxiOwl] Failed to initialize app state: {err}"));

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(target) = native::path_from_args(&argv) {
                native::emit_open_path(app, &target);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_auth_status,
            commands::get_codex_runtime_status,
            commands::trigger_login,
            commands::trigger_logout,
            commands::get_quota,
            commands::get_startup_options,
            commands::open_path,
            commands::get_workspace_info,
            commands::select_workspace,
            commands::create_workspace,
            commands::get_sibling_workspaces,
            commands::get_workspace_files,
            commands::read_file,
            commands::write_file,
            commands::create_file,
            commands::get_historical_sessions,
            commands::read_session_history,
            commands::get_session_usage,
            commands::get_models,
            commands::execute_prompt,
            commands::approve_run,
            commands::cancel_run,
            commands::minimize_window,
            commands::toggle_maximize_window,
            commands::close_window,
            commands::toggle_fullscreen_window
        ])
        .setup(|app| {
            native::setup_menu(app)?;
            if let Some(window) = app.get_webview_window("main") {
                let codex_dir = app.state::<AppState>().paths.codex_dir.clone();
                native::restore_window_state(&window, &codex_dir);
                native::setup_window_state_listener(&window, codex_dir);
                let _ = window.show();
                let _ = window.set_focus();
            }
            native::register_context_menu_if_packaged();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AxiOwl Tauri app");
}
