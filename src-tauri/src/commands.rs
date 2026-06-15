use tauri::{Emitter, Manager, Window};

use crate::{
    app_state::AppState,
    auth,
    codex_runtime,
    dto::{
        AppInfo, AuthStatus, ChatMessage, CodexRuntimeStatus, CommandResult, FilePayload,
        LoginStartResult, ModelInfo, QuotaStatus, RunStarted, SessionSummary, SessionUsage,
        StartupOptions, WorkspaceFiles, WorkspaceInfo, WorkspaceList,
    },
    files, process, quota, sessions, workspace,
};

#[tauri::command]
pub fn get_app_info(app: tauri::AppHandle) -> AppInfo {
    let package = app.package_info();
    AppInfo {
        product_name: package.name.clone(),
        version: package.version.to_string(),
    }
}

#[tauri::command]
pub fn get_auth_status(state: tauri::State<'_, AppState>) -> AuthStatus {
    auth::get_auth_status(&state)
}

#[tauri::command]
pub fn get_codex_runtime_status(state: tauri::State<'_, AppState>) -> CodexRuntimeStatus {
    codex_runtime::runtime_status(&state)
}

#[tauri::command]
pub async fn trigger_login(state: tauri::State<'_, AppState>) -> Result<LoginStartResult, String> {
    auth::trigger_login(&state).await
}

#[tauri::command]
pub async fn trigger_logout(state: tauri::State<'_, AppState>) -> Result<CommandResult, String> {
    auth::trigger_logout(&state).await
}

#[tauri::command]
pub async fn get_quota(state: tauri::State<'_, AppState>) -> Result<QuotaStatus, String> {
    quota::get_quota(&state).await
}

#[tauri::command]
pub fn get_startup_options(state: tauri::State<'_, AppState>) -> Result<StartupOptions, String> {
    workspace::startup_options(&state)
}

#[tauri::command]
pub fn open_path(state: tauri::State<'_, AppState>, path: String) -> Result<WorkspaceInfo, String> {
    workspace::open_path(&state, path)
}

#[tauri::command]
pub fn get_workspace_info(state: tauri::State<'_, AppState>) -> Result<WorkspaceInfo, String> {
    workspace::workspace_info(&state)
}

#[tauri::command]
pub fn select_workspace(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<WorkspaceInfo, String> {
    workspace::select_workspace(&state, name)
}

#[tauri::command]
pub fn create_workspace(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<WorkspaceInfo, String> {
    workspace::create_workspace(&state, name)
}

#[tauri::command]
pub fn get_sibling_workspaces(state: tauri::State<'_, AppState>) -> Result<WorkspaceList, String> {
    workspace::list_sibling_workspaces(&state)
}

#[tauri::command]
pub fn get_workspace_files(state: tauri::State<'_, AppState>) -> Result<WorkspaceFiles, String> {
    workspace::list_files(&state)
}

#[tauri::command]
pub fn read_file(state: tauri::State<'_, AppState>, path: String) -> Result<FilePayload, String> {
    files::read_file(&state, path)
}

#[tauri::command]
pub fn write_file(
    state: tauri::State<'_, AppState>,
    path: String,
    content: String,
) -> Result<FilePayload, String> {
    files::write_file(&state, path, content)
}

#[tauri::command]
pub fn create_file(
    state: tauri::State<'_, AppState>,
    relative_path: String,
) -> Result<FilePayload, String> {
    files::create_file(&state, relative_path)
}

#[tauri::command]
pub fn get_historical_sessions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SessionSummary>, String> {
    sessions::historical_sessions(&state)
}

#[tauri::command]
pub fn read_session_history(
    state: tauri::State<'_, AppState>,
    session_uuid: String,
) -> Result<Vec<ChatMessage>, String> {
    sessions::read_session_history(&state, session_uuid)
}

#[tauri::command]
pub fn get_session_usage(
    state: tauri::State<'_, AppState>,
    session_uuid: String,
) -> Result<SessionUsage, String> {
    sessions::get_session_usage(&state, session_uuid)
}

#[tauri::command]
pub async fn get_models(state: tauri::State<'_, AppState>) -> Result<Vec<ModelInfo>, String> {
    process::get_models(&state).await
}

#[tauri::command]
pub async fn execute_prompt(
    window: Window,
    state: tauri::State<'_, AppState>,
    prompt: String,
    session_uuid: String,
    model: Option<String>,
    reasoning: Option<String>,
    speed: Option<String>,
) -> Result<RunStarted, String> {
    process::execute_prompt(
        window,
        &state,
        prompt,
        session_uuid,
        model,
        reasoning,
        speed,
    )
    .await
}

#[tauri::command]
pub async fn approve_run(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<CommandResult, String> {
    process::approve_run(&state, run_id).await
}

#[tauri::command]
pub async fn cancel_run(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<CommandResult, String> {
    process::cancel_run(&state, run_id).await
}

#[tauri::command]
pub fn minimize_window(window: Window) -> Result<(), String> {
    window.minimize().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn toggle_maximize_window(window: Window) -> Result<(), String> {
    if window.is_maximized().map_err(|err| err.to_string())? {
        window.unmaximize().map_err(|err| err.to_string())
    } else {
        window.maximize().map_err(|err| err.to_string())
    }
}

#[tauri::command]
pub fn close_window(window: Window) -> Result<(), String> {
    window.close().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn toggle_fullscreen_window(window: Window) -> Result<(), String> {
    let fullscreen = window.is_fullscreen().map_err(|err| err.to_string())?;
    window
        .set_fullscreen(!fullscreen)
        .map_err(|err| err.to_string())
}

pub fn emit_menu_action(app: &tauri::AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("menu-action", action);
    }
}
