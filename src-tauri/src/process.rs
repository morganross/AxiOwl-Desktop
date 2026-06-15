use std::{
    collections::HashMap,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use serde_json::{json, Value};
use tauri::{Emitter, Manager, Window};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin},
    sync::Mutex as AsyncMutex,
};
use uuid::Uuid;

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE},
    },
};

use crate::{
    app_state::AppState,
    auth, codex_runtime,
    dto::{CommandResult, ModelInfo, ProcessEvent, RunStarted},
    events::{self, AppEvent},
    logging, paths,
};

#[derive(Clone, Debug)]
pub struct PendingApproval {
    pub request_id: Value,
    pub method: String,
}

#[derive(Clone, Debug)]
pub enum RunOutcome {
    Completed,
    Failed(String),
    Cancelled,
}

#[derive(Clone)]
pub struct ManagedRun {
    pub run_id: String,
    pub session_uuid: Option<String>,
    pub pid: u32,
    pub stdin: Arc<AsyncMutex<Option<ChildStdin>>>,
    pub pending_approval: Arc<AsyncMutex<Option<PendingApproval>>>,
    pub outcome: Arc<AsyncMutex<Option<RunOutcome>>>,
}

#[derive(Clone)]
struct AppServerLaunch {
    prompt: String,
    workspace: String,
    session_uuid: Option<String>,
    model: Option<String>,
    reasoning: Option<String>,
    speed: Option<String>,
}

const INITIALIZE_REQUEST_ID: i64 = 1;
const THREAD_REQUEST_ID: i64 = 2;
const TURN_REQUEST_ID: i64 = 3;

pub async fn execute_prompt(
    window: Window,
    state: &AppState,
    prompt: String,
    session_uuid: String,
    model: Option<String>,
    reasoning: Option<String>,
    speed: Option<String>,
) -> Result<RunStarted, String> {
    if prompt.trim().is_empty() {
        return Err("Prompt cannot be empty".to_string());
    }

    let workspace = state.active_workspace()?;
    let run_id = Uuid::new_v4().to_string();
    let session_for_registry = normalized_session(&session_uuid);

    let mut prepared = codex_runtime::codex_command(
        state,
        ["app-server", "--stdio"],
        "start Codex app-server run",
    )?;
    let command = &mut prepared.command;
    command.current_dir(&workspace);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|err| prepared.spawn_error(&err))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture app-server stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture app-server stderr")?;
    let stdin = child.stdin.take();
    let pid = child
        .id()
        .ok_or("Failed to determine app-server process id")?;
    let child = Arc::new(AsyncMutex::new(child));
    let stdin = Arc::new(AsyncMutex::new(stdin));
    let pending_approval = Arc::new(AsyncMutex::new(None::<PendingApproval>));
    let outcome = Arc::new(AsyncMutex::new(None::<RunOutcome>));
    let seq = Arc::new(AtomicU64::new(0));

    state.insert_run(ManagedRun {
        run_id: run_id.clone(),
        session_uuid: session_for_registry.clone(),
        pid,
        stdin: stdin.clone(),
        pending_approval: pending_approval.clone(),
        outcome: outcome.clone(),
    })?;

    let launch = AppServerLaunch {
        prompt,
        workspace: paths::display_path(&workspace),
        session_uuid: session_for_registry,
        model,
        reasoning,
        speed,
    };

    emit_event(
        &window,
        &run_id,
        &seq,
        "started",
        "lifecycle",
        json!({
            "type": "started",
            "transport": "app_server",
            "workspace": launch.workspace,
        }),
    );

    send_json_message(
        &stdin,
        &json!({
            "id": INITIALIZE_REQUEST_ID,
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "axiowl-desktop",
                    "version": "0.1.12"
                },
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false,
                    "optOutNotificationMethods": []
                }
            }
        }),
    )
    .await?;

    let app = window.app_handle().clone();
    spawn_stdout_task(
        app.clone(),
        window.clone(),
        run_id.clone(),
        seq.clone(),
        stdout,
        stdin,
        pending_approval,
        outcome.clone(),
        launch,
        pid,
    );
    spawn_stderr_task(
        window.clone(),
        run_id.clone(),
        seq.clone(),
        pid,
        outcome.clone(),
        stderr,
    );
    let session_for_event = state
        .get_run(&run_id)?
        .and_then(|run| run.session_uuid.clone());
    spawn_wait_task(
        app,
        window,
        run_id.clone(),
        seq,
        child,
        outcome,
        session_for_event,
    );

    Ok(RunStarted { run_id })
}

pub async fn approve_run(state: &AppState, run_id: String) -> Result<CommandResult, String> {
    let run = state
        .get_run(&run_id)?
        .ok_or_else(|| format!("No active run found for id: {run_id}"))?;

    let approval = {
        let mut pending = run.pending_approval.lock().await;
        pending
            .take()
            .ok_or_else(|| "No approval request is currently pending for this run".to_string())?
    };

    let response = approval_response(&approval)?;
    send_json_message(
        &run.stdin,
        &json!({
            "id": approval.request_id,
            "result": response,
        }),
    )
    .await?;

    Ok(CommandResult {
        success: true,
        message: Some("Approval sent".to_string()),
    })
}

pub async fn cancel_run(state: &AppState, run_id: String) -> Result<CommandResult, String> {
    let run = state
        .get_run(&run_id)?
        .ok_or_else(|| format!("No active run found for id: {run_id}"))?;
    {
        let mut outcome = run.outcome.lock().await;
        *outcome = Some(RunOutcome::Cancelled);
    }
    terminate_process_tree(run.pid).await?;
    Ok(CommandResult {
        success: true,
        message: Some("Run cancelled".to_string()),
    })
}

pub async fn get_models(state: &AppState) -> Result<Vec<ModelInfo>, String> {
    let mut prepared =
        codex_runtime::codex_command(state, ["debug", "models"], "discover Codex models")?;
    let command = &mut prepared.command;
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }

    let output = command
        .output()
        .await
        .map_err(|err| prepared.spawn_error(&err))?;
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(attach_process_stderr(
            format!(
                "`codex debug models` exited with status {}\n{}",
                output.status,
                prepared.runtime_report()
            ),
            &stderr,
        ));
    }

    let text = String::from_utf8_lossy(&output.stdout)
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string();
    let value = serde_json::from_str::<Value>(&text).map_err(|err| {
        attach_process_stderr(
            format!(
                "Failed to parse `codex debug models` JSON: {err}\n{}",
                prepared.runtime_report()
            ),
            &stderr,
        )
    })?;
    let models = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or("`codex debug models` response is missing a models array")?;

    let parsed = models
        .iter()
        .filter_map(|model| serde_json::from_value::<ModelInfo>(model.clone()).ok())
        .collect::<Vec<_>>();
    if parsed.is_empty() {
        Err(attach_process_stderr(
            format!(
                "`codex debug models` returned no usable models\n{}",
                prepared.runtime_report()
            ),
            &stderr,
        ))
    } else {
        Ok(parsed)
    }
}

fn spawn_stdout_task(
    app: tauri::AppHandle,
    window: Window,
    run_id: String,
    seq: Arc<AtomicU64>,
    stdout: impl tokio::io::AsyncRead + Unpin + Send + 'static,
    stdin: Arc<AsyncMutex<Option<ChildStdin>>>,
    pending_approval: Arc<AsyncMutex<Option<PendingApproval>>>,
    outcome: Arc<AsyncMutex<Option<RunOutcome>>>,
    launch: AppServerLaunch,
    pid: u32,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut command_output_buffers = HashMap::<String, String>::new();

        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
                emit_event(
                    &window,
                    &run_id,
                    &seq,
                    "stdout",
                    "stdout",
                    json!({ "type": "message", "content": format!("{line}\n") }),
                );
                continue;
            };

            if message.get("method").is_some() {
                handle_server_message(
                    &app,
                    &window,
                    &run_id,
                    &seq,
                    &pending_approval,
                    &outcome,
                    &message,
                    &mut command_output_buffers,
                    pid,
                )
                .await;
                continue;
            }

            if let Some(id) = message.get("id").cloned() {
                handle_response_message(
                    &app, &run_id, &stdin, &outcome, &launch, id, &message, pid,
                )
                .await;
            }
        }
    });
}

async fn handle_response_message(
    app: &tauri::AppHandle,
    run_id: &str,
    stdin: &Arc<AsyncMutex<Option<ChildStdin>>>,
    outcome: &Arc<AsyncMutex<Option<RunOutcome>>>,
    launch: &AppServerLaunch,
    id: Value,
    message: &Value,
    pid: u32,
) {
    if let Some(error) = message.get("error") {
        set_run_outcome(outcome, RunOutcome::Failed(error_message(error))).await;
        let _ = terminate_process_tree(pid).await;
        return;
    }

    let Some(id_num) = id.as_i64() else {
        return;
    };

    match id_num {
        INITIALIZE_REQUEST_ID => {
            let _ = send_json_message(stdin, &json!({ "method": "initialized" })).await;
            let request = build_thread_request(launch);
            let _ = send_json_message(
                stdin,
                &json!({
                    "id": THREAD_REQUEST_ID,
                    "method": request.0,
                    "params": request.1
                }),
            )
            .await;
        }
        THREAD_REQUEST_ID => {
            let result = message.get("result").cloned().unwrap_or(Value::Null);
            if let Some(thread_id) = result
                .get("thread")
                .and_then(|thread| thread.get("id"))
                .and_then(Value::as_str)
            {
                let state = app.state::<AppState>();
                let _ = state.set_run_session(run_id, thread_id);
                let _ = send_json_message(
                    stdin,
                    &json!({
                        "id": TURN_REQUEST_ID,
                        "method": "turn/start",
                        "params": build_turn_start_request(thread_id, launch)
                    }),
                )
                .await;
            } else {
                set_run_outcome(
                    outcome,
                    RunOutcome::Failed(
                        "App-server thread response did not include a thread id".to_string(),
                    ),
                )
                .await;
                let _ = terminate_process_tree(pid).await;
            }
        }
        TURN_REQUEST_ID => {
            if message.get("result").is_none() {
                set_run_outcome(
                    outcome,
                    RunOutcome::Failed("App-server turn response was missing a result".to_string()),
                )
                .await;
                let _ = terminate_process_tree(pid).await;
            }
        }
        _ => {}
    }
}

async fn handle_server_message(
    app: &tauri::AppHandle,
    window: &Window,
    run_id: &str,
    seq: &Arc<AtomicU64>,
    pending_approval: &Arc<AsyncMutex<Option<PendingApproval>>>,
    outcome: &Arc<AsyncMutex<Option<RunOutcome>>>,
    message: &Value,
    command_output_buffers: &mut HashMap<String, String>,
    pid: u32,
) {
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return;
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);

    match method {
        "thread/started" => {
            if let Some(thread_id) = params
                .get("thread")
                .and_then(|thread| thread.get("id"))
                .and_then(Value::as_str)
            {
                let state = app.state::<AppState>();
                let _ = state.set_run_session(run_id, thread_id);
                emit_event(
                    window,
                    run_id,
                    seq,
                    "codex_json",
                    "stdout",
                    json!({
                        "type": "thread.started",
                        "thread_id": thread_id,
                    }),
                );
            }
        }
        "item/agentMessage/delta" => {
            if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                emit_event(
                    window,
                    run_id,
                    seq,
                    "codex_json",
                    "stdout",
                    json!({
                        "type": "content_chunk",
                        "delta": { "text": delta }
                    }),
                );
            }
        }
        "item/commandExecution/requestApproval"
        | "item/fileChange/requestApproval"
        | "item/permissions/requestApproval"
        | "applyPatchApproval"
        | "execCommandApproval" => {
            let request_id = message.get("id").cloned().unwrap_or(Value::Null);
            let command = params
                .get("command")
                .and_then(Value::as_str)
                .map(str::to_string);

            {
                let mut pending = pending_approval.lock().await;
                *pending = Some(PendingApproval {
                    request_id,
                    method: method.to_string(),
                });
            }

            emit_event(
                window,
                run_id,
                seq,
                "codex_json",
                "stdout",
                json!({
                    "type": "approval_request",
                    "command": command,
                }),
            );
        }
        "item/commandExecution/outputDelta" => {
            let Some(item_id) = params.get("itemId").and_then(Value::as_str) else {
                return;
            };
            let delta = params
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or_default();
            command_output_buffers
                .entry(item_id.to_string())
                .or_default()
                .push_str(delta);
        }
        "item/completed" => {
            if let Some(item) = params.get("item") {
                handle_completed_item(window, run_id, seq, item, command_output_buffers);
            }
        }
        "thread/tokenUsage/updated" => {
            let total = params
                .get("tokenUsage")
                .and_then(|usage| usage.get("total"))
                .cloned()
                .unwrap_or(Value::Null);
            let model_context_window = params
                .get("tokenUsage")
                .and_then(|usage| usage.get("modelContextWindow"))
                .and_then(Value::as_u64);

            emit_event(
                window,
                run_id,
                seq,
                "codex_json",
                "stdout",
                json!({
                    "type": "token_count",
                    "info": {
                        "total_token_usage": {
                            "total_tokens": total.get("totalTokens").and_then(Value::as_u64),
                            "input_tokens": total.get("inputTokens").and_then(Value::as_u64),
                            "output_tokens": total.get("outputTokens").and_then(Value::as_u64),
                            "reasoning_output_tokens": total.get("reasoningOutputTokens").and_then(Value::as_u64),
                        },
                        "model_context_window": model_context_window,
                    }
                }),
            );
        }
        "turn/completed" => {
            if params
                .get("turn")
                .and_then(|turn| turn.get("status"))
                .and_then(Value::as_str)
                == Some("failed")
            {
                let error = params
                    .get("turn")
                    .and_then(|turn| turn.get("error"))
                    .map(error_message)
                    .unwrap_or_else(|| "The Codex turn failed.".to_string());
                set_run_outcome(outcome, RunOutcome::Failed(error)).await;
            } else {
                set_run_outcome(outcome, RunOutcome::Completed).await;
            }
            let _ = terminate_process_tree(pid).await;
        }
        "error" => {
            set_run_outcome(outcome, RunOutcome::Failed(error_message(&params))).await;
            let _ = terminate_process_tree(pid).await;
        }
        _ => {}
    }
}

fn handle_completed_item(
    window: &Window,
    run_id: &str,
    seq: &Arc<AtomicU64>,
    item: &Value,
    command_output_buffers: &mut HashMap<String, String>,
) {
    match item.get("type").and_then(Value::as_str) {
        Some("agentMessage") => {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                emit_event(
                    window,
                    run_id,
                    seq,
                    "codex_json",
                    "stdout",
                    json!({
                        "type": "item.completed",
                        "item": {
                            "type": "agent_message",
                            "text": text,
                        }
                    }),
                );
            }
        }
        Some("commandExecution") => {
            let item_id = item.get("id").and_then(Value::as_str).unwrap_or_default();
            let buffered_output = command_output_buffers.remove(item_id).unwrap_or_default();
            let aggregated_output = item
                .get("aggregatedOutput")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or(buffered_output);
            emit_event(
                window,
                run_id,
                seq,
                "codex_json",
                "stdout",
                json!({
                    "type": "terminal_output",
                    "command": item.get("command").and_then(Value::as_str).unwrap_or(""),
                    "output": aggregated_output,
                    "exit_code": item.get("exitCode").cloned().unwrap_or(Value::Null),
                    "status": item.get("status").cloned().unwrap_or(Value::Null),
                }),
            );
        }
        Some("fileChange") => {
            if let Some(changes) = item.get("changes").and_then(Value::as_array) {
                for change in changes {
                    if !matches!(
                        change.get("kind").and_then(Value::as_str),
                        Some("add" | "modify")
                    ) {
                        continue;
                    }
                    let Some(path) = change.get("path").and_then(Value::as_str) else {
                        continue;
                    };
                    emit_event(
                        window,
                        run_id,
                        seq,
                        "codex_json",
                        "stdout",
                        json!({
                            "type": "diff",
                            "file": std::path::Path::new(path)
                                .file_name()
                                .and_then(|name| name.to_str())
                                .unwrap_or("Unknown File"),
                            "absolutePath": path,
                            "changeKind": change.get("kind").and_then(Value::as_str).unwrap_or("modify"),
                        }),
                    );
                }
            }
        }
        _ => {}
    }
}

fn spawn_stderr_task(
    window: Window,
    run_id: String,
    seq: Arc<AtomicU64>,
    pid: u32,
    outcome: Arc<AsyncMutex<Option<RunOutcome>>>,
    stderr: impl tokio::io::AsyncRead + Unpin + Send + 'static,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() || is_noisy_output(trimmed) {
                continue;
            }

            if auth::is_authentication_failure_message(trimmed) {
                logging::error(format!(
                    "Codex app-server stderr authentication failure: {trimmed}"
                ));
                set_run_outcome(
                    &outcome,
                    RunOutcome::Failed("Authentication expired. Please sign in again.".to_string()),
                )
                .await;
                let _ = terminate_process_tree(pid).await;
                break;
            }

            logging::warn(format!("Codex app-server stderr: {trimmed}"));
            emit_event(
                &window,
                &run_id,
                &seq,
                "stderr",
                "stderr",
                json!({ "type": "message", "content": format!("{line}\n") }),
            );
        }
    });
}

fn spawn_wait_task(
    app: tauri::AppHandle,
    window: Window,
    run_id: String,
    seq: Arc<AtomicU64>,
    child: Arc<AsyncMutex<Child>>,
    outcome: Arc<AsyncMutex<Option<RunOutcome>>>,
    session_uuid: Option<String>,
) {
    tokio::spawn(async move {
        let status = {
            let mut child = child.lock().await;
            child.wait().await
        };

        let override_outcome = { outcome.lock().await.take() };
        let (payload, outcome_label) = match override_outcome {
            Some(RunOutcome::Completed) => (
                json!({ "type": "end", "exitCode": 0 }),
                "completed".to_string(),
            ),
            Some(RunOutcome::Cancelled) => (
                json!({ "type": "end", "exitCode": null, "cancelled": true }),
                "cancelled".to_string(),
            ),
            Some(RunOutcome::Failed(error)) => (
                json!({ "type": "error", "error": error }),
                "failed".to_string(),
            ),
            None => match status {
                Ok(status) => {
                    if status.success() {
                        (
                            json!({ "type": "end", "exitCode": status.code() }),
                            "completed".to_string(),
                        )
                    } else {
                        (
                            json!({ "type": "end", "exitCode": status.code(), "success": false }),
                            format!("failed exit_status={status}"),
                        )
                    }
                }
                Err(err) => (
                    json!({ "type": "error", "error": err.to_string() }),
                    format!("failed wait_error={err}"),
                ),
            },
        };
        events::publish(AppEvent::ExecutionCompleted {
            run_id: run_id.clone(),
            session_uuid,
            outcome: outcome_label,
        });
        emit_event(&window, &run_id, &seq, "exit", "lifecycle", payload);
        let state = app.state::<AppState>();
        let _ = state.remove_run(&run_id);
    });
}

async fn send_json_message(
    stdin: &Arc<AsyncMutex<Option<ChildStdin>>>,
    message: &Value,
) -> Result<(), String> {
    let mut stdin = stdin.lock().await;
    let Some(stdin) = stdin.as_mut() else {
        return Err("Run stdin is no longer available".to_string());
    };

    let payload = serde_json::to_string(message)
        .map_err(|err| format!("Failed to encode JSON-RPC message: {err}"))?;
    stdin
        .write_all(payload.as_bytes())
        .await
        .map_err(|err| format!("Failed to write app-server message: {err}"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|err| format!("Failed to terminate app-server message: {err}"))?;
    stdin
        .flush()
        .await
        .map_err(|err| format!("Failed to flush app-server message: {err}"))?;
    Ok(())
}

fn build_thread_request(launch: &AppServerLaunch) -> (&'static str, Value) {
    let mut params = json!({
        "cwd": launch.workspace,
        "approvalPolicy": "on-request",
        "sandbox": "workspace-write",
    });

    if let Some(model) = launch
        .model
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        params["model"] = Value::String(model.clone());
    }
    if let Some(speed) = launch
        .speed
        .as_ref()
        .filter(|value| value.as_str() != "default" && !value.trim().is_empty())
    {
        params["serviceTier"] = Value::String(speed.clone());
    }
    if let Some(reasoning) = launch
        .reasoning
        .as_ref()
        .filter(|value| value.as_str() != "default" && !value.trim().is_empty())
    {
        params["config"] = json!({ "model_reasoning_effort": reasoning });
    }

    if let Some(thread_id) = &launch.session_uuid {
        params["threadId"] = Value::String(thread_id.clone());
        ("thread/resume", params)
    } else {
        ("thread/start", params)
    }
}

fn build_turn_start_request(thread_id: &str, launch: &AppServerLaunch) -> Value {
    let mut params = json!({
        "threadId": thread_id,
        "input": [
            {
                "type": "text",
                "text": launch.prompt,
                "text_elements": []
            }
        ],
        "cwd": launch.workspace,
        "approvalPolicy": "on-request",
    });

    if let Some(model) = launch
        .model
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        params["model"] = Value::String(model.clone());
    }
    if let Some(speed) = launch
        .speed
        .as_ref()
        .filter(|value| value.as_str() != "default" && !value.trim().is_empty())
    {
        params["serviceTier"] = Value::String(speed.clone());
    }
    if let Some(reasoning) = launch
        .reasoning
        .as_ref()
        .filter(|value| value.as_str() != "default" && !value.trim().is_empty())
    {
        params["effort"] = Value::String(reasoning.clone());
    }

    params
}

fn approval_response(approval: &PendingApproval) -> Result<Value, String> {
    match approval.method.as_str() {
        "item/commandExecution/requestApproval" => Ok(json!({ "decision": "accept" })),
        "item/fileChange/requestApproval" => Ok(json!({ "decision": "accept" })),
        "item/permissions/requestApproval" => Ok(json!({
            "permissions": {},
            "scope": "turn",
            "strictAutoReview": false
        })),
        "applyPatchApproval" | "execCommandApproval" => Ok(json!({ "decision": "approved" })),
        other => Err(format!("Unsupported approval request type: {other}")),
    }
}

async fn set_run_outcome(outcome: &Arc<AsyncMutex<Option<RunOutcome>>>, next: RunOutcome) {
    let mut guard = outcome.lock().await;
    *guard = Some(next);
}

fn error_message(value: &Value) -> String {
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
        })
        .or_else(|| value.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string());

    if auth::is_authentication_failure_message(&message) {
        "Authentication expired. Please sign in again.".to_string()
    } else {
        message
    }
}

fn attach_process_stderr(message: String, stderr_output: &str) -> String {
    if auth::is_authentication_failure_message(&message)
        || auth::is_authentication_failure_message(stderr_output)
    {
        logging::error(format!(
            "Codex process authentication failure; message='{message}', stderr='{stderr_output}'"
        ));
        return "Authentication expired. Please sign in again.".to_string();
    }
    let output = if stderr_output.trim().is_empty() {
        message
    } else {
        format!("{message}\nCodex stderr:\n{stderr_output}")
    };
    logging::error(&output);
    output
}

fn emit_event(
    window: &Window,
    run_id: &str,
    seq: &Arc<AtomicU64>,
    event_type: &str,
    stream: &str,
    payload: Value,
) {
    let event = ProcessEvent {
        run_id: run_id.to_string(),
        seq: seq.fetch_add(1, Ordering::Relaxed) + 1,
        event_type: event_type.to_string(),
        stream: stream.to_string(),
        payload,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    let _ = window.emit("codex-event", event);
}

fn normalized_session(session_uuid: &str) -> Option<String> {
    let trimmed = session_uuid.trim();
    if trimmed.is_empty() || matches!(trimmed, "new" | "null" | "undefined") {
        None
    } else {
        Some(trimmed.to_string())
    }
}

async fn terminate_process_tree(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        return terminate_process_tree_windows(pid);
    }

    #[cfg(not(windows))]
    {
        let mut command = tokio::process::Command::new("kill");
        command.args(["-TERM", &pid.to_string()]);
        command.stdin(Stdio::null());
        command.stdout(Stdio::null());
        command.stderr(Stdio::null());

        let status = command
            .status()
            .await
            .map_err(|err| format!("Failed to invoke process termination for pid {pid}: {err}"))?;

        return if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Process termination exited with status {status} for pid {pid}"
            ))
        };
    }
}

#[cfg(windows)]
fn terminate_process_tree_windows(root_pid: u32) -> Result<(), String> {
    let process_ids = collect_process_tree_pids(root_pid)?;
    let mut failures = Vec::new();

    for pid in process_ids.into_iter().rev() {
        if let Err(err) = terminate_single_process(pid) {
            failures.push(format!("pid {pid}: {err}"));
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Failed to terminate one or more processes in the Codex run tree: {}",
            failures.join("; ")
        ))
    }
}

#[cfg(windows)]
fn collect_process_tree_pids(root_pid: u32) -> Result<Vec<u32>, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("CreateToolhelp32Snapshot failed".to_string());
    }

    let mut entries = Vec::<(u32, u32)>::new();
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..unsafe { std::mem::zeroed() }
    };

    let first_ok = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    if first_ok {
        loop {
            entries.push((entry.th32ProcessID, entry.th32ParentProcessID));
            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }

    unsafe {
        CloseHandle(snapshot);
    }

    let mut ordered = vec![root_pid];
    let mut index = 0;
    while index < ordered.len() {
        let parent = ordered[index];
        for (pid, parent_pid) in &entries {
            if *parent_pid == parent && !ordered.contains(pid) {
                ordered.push(*pid);
            }
        }
        index += 1;
    }

    Ok(ordered)
}

#[cfg(windows)]
fn terminate_single_process(pid: u32) -> Result<(), String> {
    let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
    if handle.is_null() {
        return Ok(());
    }

    let terminate_ok = unsafe { TerminateProcess(handle, 1) } != 0;
    unsafe {
        CloseHandle(handle);
    }
    if terminate_ok {
        Ok(())
    } else {
        Err("TerminateProcess failed".to_string())
    }
}

fn is_noisy_output(line: &str) -> bool {
    line.contains("\"level\":\"WARN\"")
        && (line.contains("codex_core::shell_snapshot")
            || line.contains("codex_core_plugins::manifest")
            || line.contains("codex_core_skills::loader"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        approval_response, build_thread_request, build_turn_start_request, normalized_session,
        AppServerLaunch, PendingApproval,
    };

    fn launch(session_uuid: Option<&str>) -> AppServerLaunch {
        AppServerLaunch {
            prompt: "hello".to_string(),
            workspace: "C:\\workspace".to_string(),
            session_uuid: session_uuid.map(str::to_string),
            model: Some("gpt-5-codex".to_string()),
            reasoning: Some("high".to_string()),
            speed: Some("fast".to_string()),
        }
    }

    #[test]
    fn builds_thread_start_request_for_new_session() {
        let (method, params) = build_thread_request(&launch(None));
        assert_eq!(method, "thread/start");
        assert_eq!(params["approvalPolicy"], "on-request");
        assert_eq!(params["sandbox"], "workspace-write");
        assert_eq!(params["model"], "gpt-5-codex");
        assert_eq!(params["serviceTier"], "fast");
        assert_eq!(params["config"]["model_reasoning_effort"], "high");
    }

    #[test]
    fn builds_thread_resume_request_for_existing_session() {
        let (method, params) = build_thread_request(&launch(Some("session-123")));
        assert_eq!(method, "thread/resume");
        assert_eq!(params["threadId"], "session-123");
    }

    #[test]
    fn builds_turn_start_request() {
        let params = build_turn_start_request("session-123", &launch(Some("session-123")));
        assert_eq!(params["threadId"], "session-123");
        assert_eq!(params["input"][0]["text"], "hello");
        assert_eq!(params["effort"], "high");
    }

    #[test]
    fn builds_command_approval_response() {
        let response = approval_response(&PendingApproval {
            request_id: json!(1),
            method: "item/commandExecution/requestApproval".to_string(),
        })
        .unwrap();
        assert_eq!(response["decision"], "accept");
    }

    #[test]
    fn builds_permission_approval_response() {
        let response = approval_response(&PendingApproval {
            request_id: json!(2),
            method: "item/permissions/requestApproval".to_string(),
        })
        .unwrap();
        assert_eq!(response["scope"], "turn");
        assert_eq!(response["permissions"], json!({}));
    }

    #[test]
    fn normalizes_new_session_tokens() {
        assert!(normalized_session("new").is_none());
        assert!(normalized_session(" undefined ").is_none());
        assert_eq!(
            normalized_session("session-123"),
            Some("session-123".to_string())
        );
    }

    #[test]
    fn runtime_policy_keeps_windows_run_cancellation_off_taskkill() {
        let source = include_str!("process.rs");
        assert!(source.contains("TerminateProcess"));
        assert!(!source.contains("Command::new(\"taskkill\")"));
    }
}
