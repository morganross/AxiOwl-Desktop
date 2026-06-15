use std::{collections::HashMap, process::Stdio, time::Duration};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    time::timeout,
};

use crate::{
    app_state::AppState,
    auth, codex_runtime,
    dto::{QuotaBucketStatus, QuotaStatus},
    logging,
};

const INITIALIZE_REQUEST_ID: i64 = 1;
const RATE_LIMIT_REQUEST_ID: i64 = 2;
const APP_SERVER_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetAccountRateLimitsResponse {
    rate_limits: RateLimitSnapshot,
    #[serde(default)]
    rate_limits_by_limit_id: Option<HashMap<String, RateLimitSnapshot>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateLimitSnapshot {
    limit_id: Option<String>,
    limit_name: Option<String>,
    primary: Option<RateLimitWindow>,
    secondary: Option<RateLimitWindow>,
    plan_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateLimitWindow {
    used_percent: u64,
    resets_at: Option<i64>,
}

pub async fn get_quota(state: &AppState) -> Result<QuotaStatus, String> {
    let mut prepared =
        codex_runtime::codex_command(state, ["app-server", "--stdio"], "query Codex quota")?;
    let command = &mut prepared.command;
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|err| prepared.spawn_error(&err))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("Failed to open Codex app-server stdin for quota lookup")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to open Codex app-server stdout for quota lookup")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to open Codex app-server stderr for quota lookup")?;

    let stderr_task = tokio::spawn(async move {
        let mut stderr_lines = BufReader::new(stderr).lines();
        let mut stderr_output = String::new();
        while let Ok(Some(line)) = stderr_lines.next_line().await {
            if !stderr_output.is_empty() {
                stderr_output.push('\n');
            }
            stderr_output.push_str(&line);
        }
        stderr_output
    });

    write_json_line(
        &mut stdin,
        &json!({
            "id": INITIALIZE_REQUEST_ID,
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "axiowl-desktop",
                    "version": "0.1.13"
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

    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut result = None;
    let mut request_error = None;

    loop {
        let next_line = timeout(APP_SERVER_TIMEOUT, stdout_lines.next_line())
            .await
            .map_err(|_| "Timed out waiting for Codex app-server quota response".to_string())?;
        let line = next_line
            .map_err(|err| format!("Failed to read Codex app-server quota response: {err}"))?
            .ok_or("Codex app-server exited before returning quota information")?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let message = serde_json::from_str::<Value>(trimmed)
            .map_err(|err| format!("Failed to parse Codex app-server quota JSON: {err}"))?;

        if message.get("method").is_some() {
            continue;
        }

        let Some(id) = message.get("id").and_then(Value::as_i64) else {
            continue;
        };

        if let Some(error) = message.get("error") {
            request_error = Some(error_message(error));
            break;
        }

        match id {
            INITIALIZE_REQUEST_ID => {
                write_json_line(&mut stdin, &json!({ "method": "initialized" })).await?;
                write_json_line(
                    &mut stdin,
                    &json!({
                        "id": RATE_LIMIT_REQUEST_ID,
                        "method": "account/rateLimits/read",
                        "params": Value::Null
                    }),
                )
                .await?;
            }
            RATE_LIMIT_REQUEST_ID => {
                let raw_result = message
                    .get("result")
                    .cloned()
                    .ok_or("Codex app-server quota response was missing a result payload")?;
                let parsed = serde_json::from_value::<GetAccountRateLimitsResponse>(raw_result)
                    .map_err(|err| {
                        format!("Failed to decode Codex app-server quota payload: {err}")
                    })?;
                result = Some(parsed);
                break;
            }
            _ => {}
        }
    }

    let _ = child.kill().await;
    let _ = child.wait().await;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if let Some(error) = request_error {
        return Err(attach_stderr(
            format!("Codex app-server quota request failed: {error}"),
            &stderr_output,
            &prepared.runtime_report(),
        ));
    }

    let response = result.ok_or_else(|| {
        attach_stderr(
            "Codex app-server exited before returning quota information".to_string(),
            &stderr_output,
            &prepared.runtime_report(),
        )
    })?;

    quota_status_from_response(response)
}

fn quota_status_from_response(
    response: GetAccountRateLimitsResponse,
) -> Result<QuotaStatus, String> {
    let snapshot = response.rate_limits.clone();
    let primary_bucket = quota_bucket_from_snapshot(snapshot.clone());
    let five_hour_remaining = primary_bucket.five_hour_remaining;
    let weekly_remaining = primary_bucket.weekly_remaining;

    if five_hour_remaining.is_none() && weekly_remaining.is_none() {
        return Err(
            "Codex app-server returned quota data without usable primary or secondary limits"
                .to_string(),
        );
    }

    Ok(QuotaStatus {
        success: true,
        five_hour_remaining,
        weekly_remaining,
        primary_reset_seconds: primary_bucket.primary_reset_seconds,
        secondary_reset_seconds: primary_bucket.secondary_reset_seconds,
        limit_id: primary_bucket.limit_id.clone(),
        limit_label: Some(primary_bucket.label.clone()),
        plan_type: primary_bucket.plan_type.clone(),
        additional_limits: additional_limits(&response, primary_bucket.limit_id.as_deref()),
        error: None,
    })
}

fn additional_limits(
    response: &GetAccountRateLimitsResponse,
    primary_limit_id: Option<&str>,
) -> Vec<QuotaBucketStatus> {
    let Some(limits) = response.rate_limits_by_limit_id.as_ref() else {
        return Vec::new();
    };

    let mut buckets = limits
        .values()
        .filter(|snapshot| snapshot.limit_id.as_deref() != primary_limit_id)
        .map(|snapshot| quota_bucket_from_snapshot(snapshot.clone()))
        .filter(|bucket| bucket.five_hour_remaining.is_some() || bucket.weekly_remaining.is_some())
        .collect::<Vec<_>>();
    buckets.sort_by(|left, right| left.label.cmp(&right.label));
    buckets
}

fn quota_bucket_from_snapshot(snapshot: RateLimitSnapshot) -> QuotaBucketStatus {
    QuotaBucketStatus {
        limit_id: snapshot.limit_id.clone(),
        label: limit_label(&snapshot),
        five_hour_remaining: snapshot.primary.as_ref().map(limit_remaining_percent),
        weekly_remaining: snapshot.secondary.as_ref().map(limit_remaining_percent),
        primary_reset_seconds: snapshot.primary.as_ref().and_then(limit_reset_seconds),
        secondary_reset_seconds: snapshot.secondary.as_ref().and_then(limit_reset_seconds),
        plan_type: snapshot.plan_type.clone(),
    }
}

fn limit_label(snapshot: &RateLimitSnapshot) -> String {
    snapshot
        .limit_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            snapshot
                .limit_id
                .as_deref()
                .map(|limit_id| {
                    if limit_id == "codex" {
                        "Codex"
                    } else {
                        limit_id
                    }
                })
                .map(str::to_string)
        })
        .unwrap_or_else(|| "Quota".to_string())
}

async fn write_json_line(
    stdin: &mut tokio::process::ChildStdin,
    message: &Value,
) -> Result<(), String> {
    stdin
        .write_all(message.to_string().as_bytes())
        .await
        .map_err(|err| format!("Failed to write Codex app-server request: {err}"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|err| format!("Failed to terminate Codex app-server request line: {err}"))?;
    stdin
        .flush()
        .await
        .map_err(|err| format!("Failed to flush Codex app-server request: {err}"))?;
    Ok(())
}

fn limit_remaining_percent(limit: &RateLimitWindow) -> u64 {
    100_u64.saturating_sub(limit.used_percent.min(100))
}

fn limit_reset_seconds(limit: &RateLimitWindow) -> Option<u64> {
    let resets_at = limit.resets_at?;
    let now = chrono::Utc::now().timestamp();
    Some(resets_at.saturating_sub(now).max(0) as u64)
}

fn error_message(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| serde_json::to_string(error).ok())
        .unwrap_or_else(|| "Unknown Codex app-server error".to_string());
    if auth::is_authentication_failure_message(&message) {
        "Authentication expired. Please sign in again.".to_string()
    } else {
        message
    }
}

fn attach_stderr(message: String, stderr_output: &str, runtime_report: &str) -> String {
    if auth::is_authentication_failure_message(&message)
        || auth::is_authentication_failure_message(stderr_output)
    {
        logging::error(format!(
            "Codex quota authentication failure; message='{message}', stderr='{stderr_output}'"
        ));
        return "Authentication expired. Please sign in again.".to_string();
    }
    let output = if stderr_output.trim().is_empty() {
        format!("{message}\n{runtime_report}")
    } else {
        format!("{message}\n{runtime_report}\nCodex stderr:\n{stderr_output}")
    };
    logging::error(&output);
    output
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        limit_label, quota_status_from_response, GetAccountRateLimitsResponse, RateLimitSnapshot,
    };

    #[test]
    fn maps_live_account_rate_limits_into_quota_status() {
        let response: GetAccountRateLimitsResponse = serde_json::from_value(json!({
            "rateLimits": {
                "limitId": "codex",
                "limitName": null,
                "primary": { "usedPercent": 53, "resetsAt": 1, "windowDurationMins": 300 },
                "secondary": { "usedPercent": 56, "resetsAt": 1, "windowDurationMins": 10080 },
                "planType": "pro"
            },
            "rateLimitsByLimitId": {
                "codex": {
                    "limitId": "codex",
                    "limitName": null,
                    "primary": { "usedPercent": 53, "resetsAt": 1, "windowDurationMins": 300 },
                    "secondary": { "usedPercent": 56, "resetsAt": 1, "windowDurationMins": 10080 },
                    "planType": "pro"
                }
            }
        }))
        .unwrap();

        let quota = quota_status_from_response(response).unwrap();
        assert!(quota.success);
        assert_eq!(quota.five_hour_remaining, Some(47));
        assert_eq!(quota.weekly_remaining, Some(44));
        assert_eq!(quota.primary_reset_seconds, Some(0));
        assert_eq!(quota.secondary_reset_seconds, Some(0));
        assert_eq!(quota.limit_label.as_deref(), Some("Codex"));
        assert_eq!(quota.plan_type.as_deref(), Some("pro"));
    }

    #[test]
    fn keeps_primary_bucket_and_exposes_additional_model_specific_limits() {
        let response: GetAccountRateLimitsResponse = serde_json::from_value(json!({
            "rateLimits": {
                "limitId": "codex_bengalfox",
                "limitName": "GPT-5.3-Codex-Spark",
                "primary": { "usedPercent": 0, "resetsAt": 1, "windowDurationMins": 300 },
                "secondary": { "usedPercent": 8, "resetsAt": 1, "windowDurationMins": 10080 }
            },
            "rateLimitsByLimitId": {
                "codex": {
                    "limitId": "codex",
                    "limitName": null,
                    "primary": { "usedPercent": 12, "resetsAt": 1, "windowDurationMins": 300 },
                    "secondary": { "usedPercent": 44, "resetsAt": 1, "windowDurationMins": 10080 }
                },
                "codex_bengalfox": {
                    "limitId": "codex_bengalfox",
                    "limitName": "GPT-5.3-Codex-Spark",
                    "primary": { "usedPercent": 0, "resetsAt": 1, "windowDurationMins": 300 },
                    "secondary": { "usedPercent": 8, "resetsAt": 1, "windowDurationMins": 10080 }
                }
            }
        }))
        .unwrap();

        let quota = quota_status_from_response(response).unwrap();
        assert_eq!(quota.five_hour_remaining, Some(100));
        assert_eq!(quota.weekly_remaining, Some(92));
        assert_eq!(quota.limit_label.as_deref(), Some("GPT-5.3-Codex-Spark"));
        assert_eq!(quota.additional_limits.len(), 1);
        assert_eq!(quota.additional_limits[0].label, "Codex");
        assert_eq!(quota.additional_limits[0].five_hour_remaining, Some(88));
        assert_eq!(quota.additional_limits[0].weekly_remaining, Some(56));
    }

    #[test]
    fn prefers_human_limit_name_for_labels() {
        let label = limit_label(&RateLimitSnapshot {
            limit_id: Some("codex_bengalfox".to_string()),
            limit_name: Some("GPT-5.3-Codex-Spark".to_string()),
            primary: None,
            secondary: None,
            plan_type: None,
        });
        assert_eq!(label, "GPT-5.3-Codex-Spark");
    }
}
