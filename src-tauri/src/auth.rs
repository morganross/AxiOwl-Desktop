use std::{fs, process::Stdio};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
use windows_sys::Win32::UI::Shell::ShellExecuteW;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use regex::Regex;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::{
    app_state::AppState,
    codex_runtime,
    dto::{AuthStatus, CommandResult, LoginStartResult},
    logging,
};

pub fn get_auth_status(state: &AppState) -> AuthStatus {
    let auth_file = state.paths.codex_dir.join("auth.json");
    let content = match fs::read_to_string(&auth_file) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return unauthenticated_status(),
        Err(err) => {
            let message = format!(
                "Failed to read Codex auth file '{}': {err}",
                auth_file.display()
            );
            logging::error(&message);
            return unauthenticated_error(message);
        }
    };

    let auth = match serde_json::from_str::<Value>(&content) {
        Ok(auth) => auth,
        Err(err) => {
            let message = format!(
                "Failed to parse Codex auth file '{}': {err}",
                auth_file.display()
            );
            logging::error(&message);
            return unauthenticated_error(message);
        }
    };

    parse_auth_status(&auth)
}

fn parse_auth_status(auth: &Value) -> AuthStatus {
    if let Some(token) = auth
        .get("tokens")
        .and_then(|tokens| tokens.get("id_token"))
        .and_then(Value::as_str)
    {
        let Some(decoded) = decode_jwt_payload(token) else {
            return unauthenticated_error(
                "Codex auth file contains an unreadable id_token.".to_string(),
            );
        };

        let auth_payload = decoded
            .get("https://api.openai.com/auth")
            .cloned()
            .unwrap_or(Value::Null);
        let refreshable_chatgpt_auth = has_refreshable_chatgpt_auth(auth);
        let id_token_is_fresh = !token_is_expired(&decoded);

        if !id_token_is_fresh && !refreshable_chatgpt_auth {
            return unauthenticated_error(
                "Authentication expired. Please sign in again.".to_string(),
            );
        }

        return AuthStatus {
            authenticated: id_token_is_fresh || refreshable_chatgpt_auth,
            method: Some("chatgpt".to_string()),
            name: decoded
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string),
            email: decoded
                .get("email")
                .and_then(Value::as_str)
                .map(str::to_string),
            plan: auth_payload
                .get("chatgpt_plan_type")
                .and_then(Value::as_str)
                .map(str::to_string),
            subscription_active_until: auth_payload
                .get("chatgpt_subscription_active_until")
                .cloned(),
            error: None,
        };
    }

    if auth
        .get("OPENAI_API_KEY")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
    {
        return AuthStatus {
            authenticated: true,
            method: Some("api_key".to_string()),
            name: None,
            email: None,
            plan: None,
            subscription_active_until: None,
            error: None,
        };
    }

    unauthenticated_status()
}

fn unauthenticated_status() -> AuthStatus {
    AuthStatus {
        authenticated: false,
        method: None,
        name: None,
        email: None,
        plan: None,
        subscription_active_until: None,
        error: None,
    }
}

fn unauthenticated_error(message: String) -> AuthStatus {
    AuthStatus {
        authenticated: false,
        method: None,
        name: None,
        email: None,
        plan: None,
        subscription_active_until: None,
        error: Some(message),
    }
}

pub async fn trigger_login(state: &AppState) -> Result<LoginStartResult, String> {
    let mut prepared = codex_runtime::codex_command(
        state,
        ["login", "--device-auth"],
        "start Codex device login",
    )?;
    let mut child = prepared
        .command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| prepared.spawn_error(&err))?;

    let stdout = child.stdout.take().ok_or("Could not read login stdout")?;
    let stderr = child.stderr.take().ok_or("Could not read login stderr")?;
    let url_re = Regex::new(r"https://auth\.openai\.com/[^\s]+").unwrap();
    let code_re = Regex::new(r"[A-Z0-9]{3,}-[A-Z0-9]{3,}").unwrap();

    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut stderr_output = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if !stderr_output.is_empty() {
                stderr_output.push('\n');
            }
            stderr_output.push_str(&line);
            logging::warn(format!("codex login stderr: {line}"));
        }
        stderr_output
    });

    let mut accumulated = String::new();
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        accumulated.push_str(&line);
        accumulated.push('\n');
        if let Some((url, code)) = parse_device_auth_output(&accumulated, &url_re, &code_re) {
            open_external_browser(&url)?;
            logging::info(format!(
                "Codex device login produced code and browser URL; runtime={}",
                prepared.runtime_report()
            ));
            return Ok(LoginStartResult {
                success: true,
                device_code: Some(code),
                url: Some(url),
            });
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|err| format!("Failed while waiting for codex login: {err}"))?;
    let stderr_output = stderr_task.await.unwrap_or_default();
    if is_login_rate_limited(&stderr_output) {
        let message =
            "Device sign-in is temporarily rate limited by Codex. Wait a minute and try again."
                .to_string();
        logging::error(&message);
        return Err(message);
    }
    let message = format!("Login process exited before producing a device code (status: {status})");
    Err(attach_stderr(message, &stderr_output))
}

pub async fn trigger_logout(state: &AppState) -> Result<CommandResult, String> {
    let mut prepared = codex_runtime::codex_command(state, ["logout"], "run Codex logout")?;
    let output = prepared
        .command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|err| prepared.spawn_error(&err))?;

    if !output.status.success() {
        return Err(attach_stderr(
            format!(
                "codex logout exited with status {}\n{}",
                output.status,
                prepared.runtime_report()
            ),
            &String::from_utf8_lossy(&output.stderr),
        ));
    }

    Ok(CommandResult {
        success: true,
        message: Some(format!(
            "codex logout exited with status {}\n{}",
            output.status,
            prepared.runtime_report()
        )),
    })
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn token_is_expired(payload: &Value) -> bool {
    payload
        .get("exp")
        .and_then(Value::as_i64)
        .is_some_and(|exp| exp <= chrono::Utc::now().timestamp())
}

fn has_refreshable_chatgpt_auth(auth: &Value) -> bool {
    auth.get("auth_mode")
        .and_then(Value::as_str)
        .is_some_and(|mode| mode == "chatgpt")
        && auth
            .get("tokens")
            .and_then(|tokens| tokens.get("refresh_token"))
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
}

pub fn is_authentication_failure_message(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("token_invalidated")
        || lower.contains("token_revoked")
        || lower.contains("refresh_token_invalidated")
        || lower.contains("invalidated oauth token")
        || lower.contains("oauth token for user")
        || lower.contains("your authentication token has been invalidated")
        || lower.contains("your session has ended")
        || lower.contains("please log in again")
        || lower.contains("please sign in again")
        || lower.contains("access token could not be refreshed")
}

fn is_login_rate_limited(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("device code request failed with status 429")
        || lower.contains("429 too many requests")
}

fn parse_device_auth_output(
    output: &str,
    url_re: &Regex,
    code_re: &Regex,
) -> Option<(String, String)> {
    let url = strip_ansi_sequences(url_re.find(output)?.as_str())
        .trim()
        .to_string();
    let code = strip_ansi_sequences(code_re.find(output)?.as_str())
        .trim()
        .to_string();
    Some((url, code))
}

fn strip_ansi_sequences(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            while let Some(next) = chars.next() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
            continue;
        }
        output.push(ch);
    }

    output
}

fn attach_stderr(message: String, stderr_output: &str) -> String {
    let output = if stderr_output.trim().is_empty() {
        message
    } else {
        format!("{message}\nCodex stderr:\n{stderr_output}")
    };
    logging::error(&output);
    output
}

fn open_external_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let operation = wide_null("open");
        let target = wide_null(url);
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        } as isize;

        if result <= 32 {
            return Err(format!(
                "Failed to open the device-auth URL in your browser; ShellExecuteW returned {result}"
            ));
        }

        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        let status = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|err| format!("Failed to open the device-auth URL in your browser: {err}"))?;

        return if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Failed to open the device-auth URL in your browser; opener exited with status {status}"
            ))
        };
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        let status = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|err| format!("Failed to open the device-auth URL in your browser: {err}"))?;

        return if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Failed to open the device-auth URL in your browser; opener exited with status {status}"
            ))
        };
    }
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use regex::Regex;

    use super::{
        decode_jwt_payload, get_auth_status, has_refreshable_chatgpt_auth, parse_auth_status,
        parse_device_auth_output, strip_ansi_sequences, token_is_expired,
    };
    use crate::app_state::{AppPaths, AppState};
    use serde_json::json;

    #[test]
    fn invalid_jwt_returns_none() {
        assert!(decode_jwt_payload("not-a-jwt").is_none());
    }

    #[test]
    fn null_api_key_does_not_mark_authenticated() {
        let status = parse_auth_status(&json!({
            "OPENAI_API_KEY": null
        }));
        assert!(!status.authenticated);
    }

    #[test]
    fn empty_api_key_does_not_mark_authenticated() {
        let status = parse_auth_status(&json!({
            "OPENAI_API_KEY": "   "
        }));
        assert!(!status.authenticated);
    }

    #[test]
    fn non_empty_api_key_marks_authenticated() {
        let status = parse_auth_status(&json!({
            "OPENAI_API_KEY": "sk-test"
        }));
        assert!(status.authenticated);
        assert_eq!(status.method.as_deref(), Some("api_key"));
    }

    #[test]
    fn missing_auth_file_is_unauthenticated() {
        let state = temp_state();
        let status = get_auth_status(&state);
        assert!(!status.authenticated);
        assert!(status.method.is_none());
    }

    #[test]
    fn invalid_auth_json_is_unauthenticated() {
        let state = temp_state();
        fs::write(state.paths.codex_dir.join("auth.json"), "{not-json").unwrap();

        let status = get_auth_status(&state);
        assert!(!status.authenticated);
        assert!(status.method.is_none());
    }

    #[test]
    fn expired_jwt_without_refresh_token_does_not_mark_authenticated() {
        let status = parse_auth_status(&json!({
            "auth_mode": "chatgpt",
            "tokens": {
                "id_token": "header.eyJleHAiOjF9.signature"
            }
        }));
        assert!(!status.authenticated);
    }

    #[test]
    fn token_expiry_helper_recognizes_future_and_past_expiry() {
        assert!(token_is_expired(&json!({ "exp": 1 })));
        assert!(!token_is_expired(&json!({ "exp": 9_999_999_999_i64 })));
    }

    #[test]
    fn expired_jwt_with_refreshable_chatgpt_auth_stays_authenticated() {
        let status = parse_auth_status(&json!({
            "auth_mode": "chatgpt",
            "tokens": {
                "id_token": "header.eyJleHAiOjEsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsIm5hbWUiOiJUZXN0IFVzZXIifQ.signature",
                "refresh_token": "refresh-token"
            }
        }));
        assert!(status.authenticated);
        assert_eq!(status.method.as_deref(), Some("chatgpt"));
        assert_eq!(status.email.as_deref(), Some("test@example.com"));
    }

    #[test]
    fn refreshable_chatgpt_auth_requires_mode_and_refresh_token() {
        assert!(has_refreshable_chatgpt_auth(&json!({
            "auth_mode": "chatgpt",
            "tokens": { "refresh_token": "refresh-token" }
        })));
        assert!(!has_refreshable_chatgpt_auth(&json!({
            "auth_mode": "chatgpt",
            "tokens": { "refresh_token": "" }
        })));
        assert!(!has_refreshable_chatgpt_auth(&json!({
            "auth_mode": "api_key",
            "tokens": { "refresh_token": "refresh-token" }
        })));
    }

    #[test]
    fn parses_device_auth_output_with_ansi_sequences() {
        let output = "\
Welcome to Codex [v\u{1b}[90m0.140.0-alpha.2\u{1b}[0m]\n\
\u{1b}[90mOpenAI's command-line coding agent\u{1b}[0m\n\
\n\
Follow these steps to sign in with ChatGPT using device code authorization:\n\
\n\
1. Open this link in your browser and sign in to your account\n\
   \u{1b}[94mhttps://auth.openai.com/codex/device\u{1b}[0m\n\
\n\
2. Enter this one-time code \u{1b}[90m(expires in 15 minutes)\u{1b}[0m\n\
   \u{1b}[94mNFD8-KSBQK\u{1b}[0m\n";
        let url_re = Regex::new(r"https://auth\.openai\.com/[^\s]+").unwrap();
        let code_re = Regex::new(r"[A-Z0-9]{3,}-[A-Z0-9]{3,}").unwrap();
        let parsed = parse_device_auth_output(output, &url_re, &code_re).unwrap();
        assert_eq!(parsed.0, "https://auth.openai.com/codex/device");
        assert_eq!(parsed.1, "NFD8-KSBQK");
    }

    #[test]
    fn strips_ansi_sequences_from_text() {
        let input = "\u{1b}[94mhttps://auth.openai.com/codex/device\u{1b}[0m";
        assert_eq!(
            strip_ansi_sequences(input),
            "https://auth.openai.com/codex/device"
        );
    }

    #[test]
    fn runtime_policy_keeps_windows_browser_open_off_shell_helpers() {
        let source = include_str!("auth.rs");
        assert!(source.contains("ShellExecuteW"));
        assert!(!source.contains("Command::new(\"cmd\")"));
    }

    fn temp_state() -> AppState {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        let base = std::env::temp_dir().join(format!("axiowl_auth_test_{unique}"));
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
            runs_by_id: std::sync::Mutex::new(HashMap::new()),
            runs_by_session: std::sync::Mutex::new(HashMap::new()),
        }
    }
}
