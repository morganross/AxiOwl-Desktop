use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use chrono::DateTime;
use serde_json::Value;

use crate::{
    app_state::AppState,
    dto::{ChatContentPart, ChatMessage, SessionSummary, SessionUsage},
};

pub fn historical_sessions(state: &AppState) -> Result<Vec<SessionSummary>, String> {
    let mut sessions = HashMap::<String, SessionSummary>::new();
    load_session_index_entries(state, &mut sessions)?;
    load_session_file_entries(state, &mut sessions)?;

    let mut sessions = sessions.into_values().collect::<Vec<_>>();
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions.truncate(15);
    Ok(sessions)
}

pub fn read_session_history(
    state: &AppState,
    session_uuid: String,
) -> Result<Vec<ChatMessage>, String> {
    if session_uuid.trim().is_empty() {
        return Err("Missing session UUID".to_string());
    }

    let sessions_dir = state.paths.codex_dir.join("sessions");
    let session_file = find_session_file(&sessions_dir, &session_uuid)
        .ok_or_else(|| format!("Session file not found for UUID: {session_uuid}"))?;

    let content = fs::read_to_string(&session_file).map_err(|err| {
        format!(
            "Failed to read session file '{}': {err}",
            session_file.display()
        )
    })?;
    Ok(parse_session_messages(&content))
}

pub fn get_session_usage(state: &AppState, session_uuid: String) -> Result<SessionUsage, String> {
    if session_uuid.trim().is_empty() {
        return Err("Missing session UUID".to_string());
    }

    let sessions_dir = state.paths.codex_dir.join("sessions");
    let session_file = find_session_file(&sessions_dir, &session_uuid)
        .ok_or_else(|| format!("Session file not found for UUID: {session_uuid}"))?;

    let content = fs::read_to_string(&session_file).map_err(|err| {
        format!(
            "Failed to read session file '{}': {err}",
            session_file.display()
        )
    })?;

    Ok(parse_session_usage(&content))
}

fn load_session_index_entries(
    state: &AppState,
    sessions: &mut HashMap<String, SessionSummary>,
) -> Result<(), String> {
    let session_index = state.paths.codex_dir.join("session_index.jsonl");
    if !session_index.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&session_index).map_err(|err| {
        format!(
            "Failed to read session index '{}': {err}",
            session_index.display()
        )
    })?;

    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(uuid) = value.get("id").and_then(Value::as_str) else {
            continue;
        };

        let title = value
            .get("thread_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| default_session_title(uuid));
        let updated_at = value
            .get("updated_at")
            .and_then(Value::as_str)
            .and_then(parse_timestamp_ms)
            .unwrap_or(0);

        sessions.insert(
            uuid.to_string(),
            SessionSummary {
                uuid: uuid.to_string(),
                title,
                updated_at,
                is_running: state.is_session_running(uuid),
            },
        );
    }

    Ok(())
}

fn load_session_file_entries(
    state: &AppState,
    sessions: &mut HashMap<String, SessionSummary>,
) -> Result<(), String> {
    let session_files = collect_session_files(&state.paths.codex_dir.join("sessions"))?;

    for path in session_files {
        let Some(summary) = parse_session_summary_from_file(&path, state)? else {
            continue;
        };

        match sessions.get_mut(&summary.uuid) {
            Some(existing) => {
                if existing.title == default_session_title(&summary.uuid)
                    && summary.title != default_session_title(&summary.uuid)
                {
                    existing.title = summary.title;
                }
                if summary.updated_at > existing.updated_at {
                    existing.updated_at = summary.updated_at;
                }
                existing.is_running = state.is_session_running(&summary.uuid);
            }
            None => {
                sessions.insert(summary.uuid.clone(), summary);
            }
        }
    }

    Ok(())
}

fn parse_session_messages(content: &str) -> Vec<ChatMessage> {
    let mut messages = Vec::new();

    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("response_item") {
            continue;
        }

        let payload = &value["payload"];
        if payload.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }

        let Some(role) = payload.get("role").and_then(Value::as_str) else {
            continue;
        };
        if role != "user" && role != "assistant" {
            continue;
        }

        let text = extract_message_text(&payload["content"]);
        if text.trim().is_empty() || is_ignorable_session_text(&text) {
            continue;
        }

        messages.push(ChatMessage {
            role: role.to_string(),
            content: vec![ChatContentPart {
                kind: "text".to_string(),
                text,
            }],
        });
    }

    messages
}

fn parse_session_summary_from_file(
    path: &Path,
    state: &AppState,
) -> Result<Option<SessionSummary>, String> {
    let content = fs::read_to_string(path)
        .map_err(|err| format!("Failed to read session file '{}': {err}", path.display()))?;
    let mut uuid = None::<String>;
    let mut title = None::<String>;
    let mut updated_at = file_timestamp_ms(path);

    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if let Some(timestamp) = value
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_timestamp_ms)
        {
            updated_at = updated_at.max(timestamp);
        }

        match value.get("type").and_then(Value::as_str) {
            Some("session_meta") => {
                if uuid.is_none() {
                    uuid = value
                        .get("payload")
                        .and_then(|payload| payload.get("id"))
                        .and_then(Value::as_str)
                        .map(str::to_string);
                }
            }
            Some("event_msg") if title.is_none() => {
                let payload = &value["payload"];
                if payload.get("type").and_then(Value::as_str) == Some("user_message") {
                    title = payload
                        .get("message")
                        .and_then(Value::as_str)
                        .and_then(extract_session_title_candidate)
                        .filter(|value| !value.is_empty());
                }
            }
            Some("response_item") if title.is_none() => {
                let payload = &value["payload"];
                if payload.get("type").and_then(Value::as_str) == Some("message")
                    && payload.get("role").and_then(Value::as_str) == Some("user")
                {
                    let extracted = extract_message_text(&payload["content"]);
                    if let Some(normalized) = extract_session_title_candidate(&extracted) {
                        title = Some(normalized);
                    }
                }
            }
            _ => {}
        }
    }

    let Some(uuid) = uuid else {
        return Ok(None);
    };
    let title = title.unwrap_or_else(|| default_session_title(&uuid));
    Ok(Some(SessionSummary {
        uuid: uuid.clone(),
        title,
        updated_at,
        is_running: state.is_session_running(&uuid),
    }))
}

fn extract_message_text(content: &Value) -> String {
    let Some(parts) = content.as_array() else {
        return content.as_str().unwrap_or_default().to_string();
    };

    let mut text = String::new();
    for part in parts {
        let kind = part.get("type").and_then(Value::as_str).unwrap_or_default();
        if matches!(kind, "input_text" | "output_text" | "text") {
            if let Some(value) = part.get("text").and_then(Value::as_str) {
                text.push_str(value);
            }
        }
    }
    text
}

fn parse_session_usage(content: &str) -> SessionUsage {
    let mut total_tokens = None::<u64>;
    let mut context_window = None::<u64>;
    let mut model = None::<String>;

    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        match value.get("type").and_then(Value::as_str) {
            Some("event_msg") => {
                let payload = &value["payload"];
                match payload.get("type").and_then(Value::as_str) {
                    Some("token_count") => {
                        let info = &payload["info"];
                        total_tokens = info
                            .get("total_token_usage")
                            .and_then(|usage| usage.get("total_tokens"))
                            .and_then(Value::as_u64)
                            .or_else(|| {
                                let usage = info.get("total_token_usage")?;
                                Some(
                                    usage
                                        .get("input_tokens")
                                        .and_then(Value::as_u64)
                                        .unwrap_or(0)
                                        + usage
                                            .get("output_tokens")
                                            .and_then(Value::as_u64)
                                            .unwrap_or(0),
                                )
                            });

                        if let Some(window) =
                            info.get("model_context_window").and_then(Value::as_u64)
                        {
                            context_window = Some(window);
                        }
                    }
                    Some("task_started") => {
                        if let Some(window) =
                            payload.get("model_context_window").and_then(Value::as_u64)
                        {
                            context_window = Some(window);
                        }
                    }
                    _ => {}
                }
            }
            Some("turn_context") => {
                if let Some(value) = value
                    .get("payload")
                    .and_then(|payload| payload.get("model"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    model = Some(value.to_string());
                }
            }
            _ => {}
        }
    }

    SessionUsage {
        total_tokens,
        context_window,
        model,
    }
}

fn extract_session_title_candidate(value: &str) -> Option<String> {
    if is_ignorable_session_wrapper(value) {
        return None;
    }

    let normalized = normalize_session_title(value);
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_session_title(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !is_ignorable_session_line(line))
        .unwrap_or_default()
        .chars()
        .take(120)
        .collect::<String>()
}

fn is_ignorable_session_text(value: &str) -> bool {
    normalize_session_title(value).is_empty()
}

fn is_ignorable_session_wrapper(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    (lower.contains("agents.md") && lower.contains("<instructions>"))
        || lower.contains("<environment_context>")
}

fn is_ignorable_session_line(line: &str) -> bool {
    if line.is_empty() {
        return true;
    }

    let lower = line.to_ascii_lowercase();

    lower.starts_with("# agents.md")
        || lower.starts_with("<instructions>")
        || lower.starts_with("</instructions>")
        || lower.starts_with("<environment_context>")
        || lower.starts_with("</environment_context>")
        || line.starts_with("## ")
        || line.starts_with("```")
        || lower.starts_with("[active file:")
        || lower.starts_with("[recent terminal output]")
        || lower.starts_with("current working directory:")
}

fn collect_session_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    collect_session_files_inner(dir, &mut files)?;
    Ok(files)
}

fn collect_session_files_inner(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|err| {
        format!(
            "Failed to read session directory '{}': {err}",
            dir.display()
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read session entry: {err}"))?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|err| {
            format!(
                "Failed to inspect session entry '{}': {err}",
                path.display()
            )
        })?;

        if file_type.is_dir() {
            collect_session_files_inner(&path, files)?;
            continue;
        }

        if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }

    Ok(())
}

fn find_session_file(dir: &Path, uuid: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_session_file(&path, uuid) {
                return Some(found);
            }
        } else if path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.ends_with(&format!("{uuid}.jsonl")))
            .unwrap_or(false)
        {
            return Some(path);
        }
    }
    None
}

fn parse_timestamp_ms(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn file_timestamp_ms(path: &Path) -> i64 {
    path.metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_to_millis)
        .unwrap_or(0)
}

fn system_time_to_millis(value: SystemTime) -> Option<i64> {
    let duration = value.duration_since(SystemTime::UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_millis()).ok()
}

fn default_session_title(uuid: &str) -> String {
    uuid.to_string()
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        normalize_session_title, parse_session_messages, parse_session_summary_from_file,
        parse_session_usage,
    };
    use crate::app_state::{AppPaths, AppState};

    #[test]
    fn parser_skips_invalid_lines_and_keeps_user_assistant_messages() {
        let input = r#"
not json
{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"text","text":"hidden"}]}}
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"text","text":"hello"}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}}
"#;
        let messages = parse_session_messages(input);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content[0].text, "hello");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content[0].text, "hi");
    }

    #[test]
    fn parses_session_summary_from_real_session_file() {
        let state = temp_state();
        let sessions_dir = state
            .paths
            .codex_dir
            .join("sessions")
            .join("2026")
            .join("06")
            .join("15");
        fs::create_dir_all(&sessions_dir).unwrap();
        let path = sessions_dir.join("rollout-2026-06-15T01-25-04-session-1.jsonl");
        fs::write(
            &path,
            concat!(
                "{\"timestamp\":\"2026-06-15T01:25:06.241Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"session-1\"}}\n",
                "{\"timestamp\":\"2026-06-15T01:25:20.862Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Real prompt title\"}}\n"
            ),
        )
        .unwrap();

        let summary = parse_session_summary_from_file(&path, &state)
            .unwrap()
            .unwrap();
        assert_eq!(summary.uuid, "session-1");
        assert_eq!(summary.title, "Real prompt title");
    }

    #[test]
    fn session_title_skips_agents_wrapper_lines() {
        assert_eq!(
            normalize_session_title(
                "# AGENTS.md instructions for C:\\Users\\kjhgf\\AxiOwl\\workspace\n\n<INSTRUCTIONS>\n# AGENTS.md\n\ncreate a file named hello.txt"
            ),
            "create a file named hello.txt"
        );
        assert_eq!(
            normalize_session_title(
                "# agents.md\n\n<instructions>\ncreate a file named lowercase.txt"
            ),
            "create a file named lowercase.txt"
        );
        assert!(super::extract_session_title_candidate(
            "# agents.md\n\n<instructions>\nPurpose: compact single-source operating context"
        )
        .is_none());
    }

    #[test]
    fn session_summary_uses_first_meaningful_user_prompt_after_metadata() {
        let state = temp_state();
        let sessions_dir = state
            .paths
            .codex_dir
            .join("sessions")
            .join("2026")
            .join("06")
            .join("15");
        fs::create_dir_all(&sessions_dir).unwrap();
        let path = sessions_dir.join("rollout-2026-06-15T02-25-04-session-2.jsonl");
        fs::write(
            &path,
            concat!(
                "{\"timestamp\":\"2026-06-15T02:25:06.241Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"session-2\"}}\n",
                "{\"timestamp\":\"2026-06-15T02:25:10.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"# AGENTS.md instructions for C:\\\\Users\\\\kjhgf\\\\AxiOwl\\\\workspace\\n\\n<INSTRUCTIONS>\\n# AGENTS.md\"}}\n",
                "{\"timestamp\":\"2026-06-15T02:25:20.862Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"create a file named hello.txt with exactly this text: hi\"}}\n"
            ),
        )
        .unwrap();

        let summary = parse_session_summary_from_file(&path, &state)
            .unwrap()
            .unwrap();
        assert_eq!(summary.uuid, "session-2");
        assert_eq!(
            summary.title,
            "create a file named hello.txt with exactly this text: hi"
        );
    }

    #[test]
    fn session_index_without_updated_at_does_not_invent_current_time() {
        let state = temp_state();
        fs::write(
            state.paths.codex_dir.join("session_index.jsonl"),
            r#"{"id":"session-3","thread_name":"Missing timestamp"}"#,
        )
        .unwrap();

        let sessions = super::historical_sessions(&state).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].uuid, "session-3");
        assert_eq!(sessions[0].updated_at, 0);
    }

    #[test]
    fn parses_real_session_usage_from_token_count_events() {
        let usage = parse_session_usage(concat!(
            "{\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5-codex\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"model_context_window\":258400}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":1200,\"output_tokens\":300,\"total_tokens\":1500},\"model_context_window\":272000}}}\n"
        ));

        assert_eq!(usage.model.as_deref(), Some("gpt-5-codex"));
        assert_eq!(usage.total_tokens, Some(1500));
        assert_eq!(usage.context_window, Some(272000));
    }

    #[test]
    fn usage_parser_falls_back_to_input_plus_output_when_total_missing() {
        let usage = parse_session_usage(
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":900,\"output_tokens\":100}}}}",
        );

        assert_eq!(usage.total_tokens, Some(1000));
    }

    fn temp_state() -> AppState {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        let base = std::env::temp_dir().join(format!("axiowl_sessions_test_{unique}"));
        fs::create_dir_all(&base).unwrap();
        let codex_dir = base.join(".codex");
        let workspace = base.join("workspace");
        fs::create_dir_all(&codex_dir).unwrap();
        fs::create_dir_all(&workspace).unwrap();

        AppState {
            paths: AppPaths {
                home_dir: base.clone(),
                codex_dir,
                qexow_main_dir: base,
            },
            active_workspace: std::sync::Mutex::new(workspace),
            initial_file_to_open: std::sync::Mutex::new(None),
            runs_by_id: std::sync::Mutex::new(std::collections::HashMap::new()),
            runs_by_session: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
}
