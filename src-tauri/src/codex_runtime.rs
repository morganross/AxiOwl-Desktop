use std::{
    collections::HashSet,
    env,
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Mutex, OnceLock},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::{
    app_state::AppState,
    dto::{CodexRuntimeAttempt, CodexRuntimeStatus},
    logging,
};

const VERSION_ARG: &str = "--version";
const MAX_DETAIL_CHARS: usize = 600;

static RUNTIME_CACHE: OnceLock<Mutex<Option<CodexRuntime>>> = OnceLock::new();

#[derive(Clone, Debug)]
pub struct CodexRuntime {
    pub executable: PathBuf,
    pub source: String,
    pub version: String,
    pub attempts: Vec<DiscoveryAttempt>,
}

#[derive(Clone, Debug)]
pub struct DiscoveryAttempt {
    pub source: String,
    pub path: Option<String>,
    pub status: DiscoveryStatus,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiscoveryStatus {
    Accepted,
    Rejected,
    SourceUnavailable,
}

#[derive(Clone, Debug)]
pub struct CodexDiscoveryError {
    attempts: Vec<DiscoveryAttempt>,
}

pub struct PreparedCodexCommand {
    pub command: tokio::process::Command,
    runtime: CodexRuntime,
    purpose: String,
}

pub fn codex_command<const N: usize>(
    state: &AppState,
    args: [&str; N],
    purpose: &str,
) -> Result<PreparedCodexCommand, String> {
    let runtime = resolve_runtime().map_err(|err| err.user_message(purpose))?;
    let mut command = tokio::process::Command::new(&runtime.executable);
    command.args(args);
    command.env("CODEX_HOME", &state.paths.codex_dir);
    command.env("AXIOWL_CODEX_EXE", &runtime.executable);
    command.stdin(Stdio::null());

    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }

    logging::info(format!(
        "Codex command prepared; purpose='{purpose}', executable='{}', source='{}', version='{}', CODEX_HOME='{}'",
        runtime.executable.display(),
        runtime.source,
        runtime.version,
        state.paths.codex_dir.display()
    ));

    Ok(PreparedCodexCommand {
        command,
        runtime,
        purpose: purpose.to_string(),
    })
}

pub fn runtime_status(state: &AppState) -> CodexRuntimeStatus {
    match resolve_runtime() {
        Ok(runtime) => CodexRuntimeStatus {
            available: true,
            codex_home: state.paths.codex_dir.to_string_lossy().to_string(),
            executable: Some(runtime.executable.to_string_lossy().to_string()),
            source: Some(runtime.source),
            version: Some(runtime.version),
            attempts: runtime
                .attempts
                .into_iter()
                .map(runtime_attempt)
                .collect::<Vec<_>>(),
            error: None,
        },
        Err(err) => CodexRuntimeStatus {
            available: false,
            codex_home: state.paths.codex_dir.to_string_lossy().to_string(),
            executable: None,
            source: None,
            version: None,
            attempts: err
                .attempts
                .iter()
                .cloned()
                .map(runtime_attempt)
                .collect::<Vec<_>>(),
            error: Some(err.user_message("run Codex-backed desktop features")),
        },
    }
}

impl PreparedCodexCommand {
    pub fn spawn_error(&self, err: &impl std::fmt::Display) -> String {
        logging::error(format!(
            "Codex command failed to start; purpose='{}', executable='{}', error='{err}'",
            self.purpose,
            self.runtime.executable.display()
        ));
        format!(
            "Failed to start Codex for {} using '{}': {err}\n{}",
            self.purpose,
            self.runtime.executable.display(),
            self.runtime.brief_report()
        )
    }

    pub fn runtime_report(&self) -> String {
        self.runtime.brief_report()
    }
}

pub fn resolve_runtime() -> Result<CodexRuntime, CodexDiscoveryError> {
    if let Some(runtime) = cached_runtime_if_valid() {
        logging::info(format!(
            "Codex runtime cache verified; executable='{}', source='{}', version='{}'",
            runtime.executable.display(),
            runtime.source,
            runtime.version
        ));
        return Ok(runtime);
    }

    let mut attempts = Vec::new();
    let candidates = collect_candidates(&mut attempts);

    logging::info(format!(
        "Starting aggressive Codex runtime discovery with {} candidate(s)",
        candidates.len()
    ));

    let mut selected = None::<(Candidate, DiscoveryAttempt)>;

    for candidate in candidates {
        let attempt = validate_candidate(&candidate);
        logging::info(format_attempt(&attempt));
        let accepted = attempt.status == DiscoveryStatus::Accepted;
        if accepted && selected.is_none() {
            selected = Some((candidate.clone(), attempt.clone()));
        }
        attempts.push(attempt);
    }

    if let Some((candidate, accepted_attempt)) = selected {
        let runtime = CodexRuntime {
            executable: PathBuf::from(
                accepted_attempt
                    .path
                    .as_deref()
                    .expect("accepted candidates always have a path"),
            ),
            source: candidate.source,
            version: accepted_attempt.detail.clone(),
            attempts: attempts.clone(),
        };
        logging::info(format!(
            "Codex runtime discovery selected '{}'; source='{}'; validated_attempts={}",
            runtime.executable.display(),
            runtime.source,
            runtime.attempts.len()
        ));
        cache_runtime(runtime.clone());
        return Ok(runtime);
    }

    logging::error(format!(
        "Codex runtime discovery failed. {}",
        format_attempts(&attempts)
    ));
    Err(CodexDiscoveryError { attempts })
}

fn cached_runtime_if_valid() -> Option<CodexRuntime> {
    let cache = RUNTIME_CACHE.get_or_init(|| Mutex::new(None));
    let runtime = cache.lock().ok()?.clone()?;
    if runtime.executable.is_file() {
        match probe_version(&runtime.executable) {
            Ok(version) => {
                let mut refreshed = runtime.clone();
                refreshed.version = version;
                return Some(refreshed);
            }
            Err(err) => {
                logging::warn(format!(
                    "Discarding stale Codex runtime cache; cached executable could not be re-validated: '{}' ({err})",
                    runtime.executable.display()
                ));
            }
        }
    }

    if !runtime.executable.is_file() {
        logging::warn(format!(
            "Discarding stale Codex runtime cache; executable no longer exists: '{}'",
            runtime.executable.display()
        ));
    }
    if let Ok(mut guard) = cache.lock() {
        *guard = None;
    }
    None
}

fn cache_runtime(runtime: CodexRuntime) {
    let cache = RUNTIME_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = cache.lock() {
        *guard = Some(runtime);
    }
}

#[derive(Clone, Debug)]
struct Candidate {
    source: String,
    path: PathBuf,
}

fn collect_candidates(attempts: &mut Vec<DiscoveryAttempt>) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::<String>::new();

    for var in [
        "AXIOWL_CODEX_EXE",
        "CAM_CODEX_EXE",
        "CODEX_EXE",
        "OPENAI_CODEX_EXE",
    ] {
        match env::var_os(var) {
            Some(value) if !value.is_empty() => push_candidate(
                &mut candidates,
                &mut seen,
                format!("environment variable {var}"),
                PathBuf::from(strip_outer_quotes(&value)),
            ),
            Some(_) => attempts.push(source_unavailable(
                format!("environment variable {var}"),
                "Variable is set but empty",
            )),
            None => attempts.push(source_unavailable(
                format!("environment variable {var}"),
                "Variable is not set",
            )),
        }
    }

    collect_localappdata_candidates(&mut candidates, &mut seen, attempts);
    collect_path_candidates(&mut candidates, &mut seen, attempts);
    collect_where_candidates(attempts);
    collect_windowsapps_candidates(&mut candidates, &mut seen, attempts);

    candidates
}

fn collect_localappdata_candidates(
    candidates: &mut Vec<Candidate>,
    seen: &mut HashSet<String>,
    attempts: &mut Vec<DiscoveryAttempt>,
) {
    let Some(local_app_data) = env::var_os("LOCALAPPDATA") else {
        attempts.push(source_unavailable(
            "LOCALAPPDATA Codex install",
            "LOCALAPPDATA is not set",
        ));
        return;
    };

    let bin_dir = PathBuf::from(local_app_data)
        .join("OpenAI")
        .join("Codex")
        .join("bin");
    push_candidate(
        candidates,
        seen,
        "LOCALAPPDATA OpenAI Codex bin",
        bin_dir.join(executable_name()),
    );

    match std::fs::read_dir(&bin_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                if entry.file_type().map(|ty| ty.is_dir()).unwrap_or(false) {
                    push_candidate(
                        candidates,
                        seen,
                        "LOCALAPPDATA OpenAI Codex versioned bin",
                        entry.path().join(executable_name()),
                    );
                }
            }
        }
        Err(err) => attempts.push(source_unavailable(
            "LOCALAPPDATA OpenAI Codex versioned bin",
            format!("Could not inspect '{}': {err}", bin_dir.display()),
        )),
    }
}

fn collect_path_candidates(
    candidates: &mut Vec<Candidate>,
    seen: &mut HashSet<String>,
    attempts: &mut Vec<DiscoveryAttempt>,
) {
    let Some(path_value) = env::var_os("PATH") else {
        attempts.push(source_unavailable("PATH", "PATH is not set"));
        return;
    };

    let mut found_any = false;
    for entry in env::split_paths(&path_value) {
        found_any = true;
        push_candidate(
            candidates,
            seen,
            "PATH entry",
            entry.join(executable_name()),
        );
    }

    if !found_any {
        attempts.push(source_unavailable("PATH", "PATH has no entries"));
    }
}

fn collect_where_candidates(attempts: &mut Vec<DiscoveryAttempt>) {
    attempts.push(source_unavailable(
        "where.exe codex",
        "Disabled by runtime policy; PATH entries are scanned directly without launching shell helpers",
    ));
}

fn collect_windowsapps_candidates(
    candidates: &mut Vec<Candidate>,
    seen: &mut HashSet<String>,
    attempts: &mut Vec<DiscoveryAttempt>,
) {
    #[cfg(windows)]
    {
        let roots = ["ProgramFiles", "ProgramW6432"];
        let mut inspected_any = false;
        for var in roots {
            let Some(root) = env::var_os(var) else {
                attempts.push(source_unavailable(
                    format!("{var} WindowsApps Codex package"),
                    format!("{var} is not set"),
                ));
                continue;
            };
            let windows_apps = PathBuf::from(root).join("WindowsApps");
            match std::fs::read_dir(&windows_apps) {
                Ok(entries) => {
                    inspected_any = true;
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with("OpenAI.Codex_") {
                            push_candidate(
                                candidates,
                                seen,
                                "WindowsApps OpenAI.Codex package resources",
                                entry
                                    .path()
                                    .join("app")
                                    .join("resources")
                                    .join(executable_name()),
                            );
                        }
                    }
                }
                Err(err) => attempts.push(source_unavailable(
                    format!("{var} WindowsApps Codex package"),
                    format!("Could not inspect '{}': {err}", windows_apps.display()),
                )),
            }
        }

        if !inspected_any {
            attempts.push(source_unavailable(
                "WindowsApps OpenAI.Codex package resources",
                "No WindowsApps package roots could be inspected",
            ));
        }
    }

    #[cfg(not(windows))]
    {
        attempts.push(source_unavailable(
            "WindowsApps OpenAI.Codex package resources",
            "WindowsApps discovery is Windows-only",
        ));
    }
}

fn push_candidate(
    candidates: &mut Vec<Candidate>,
    seen: &mut HashSet<String>,
    source: impl Into<String>,
    path: PathBuf,
) {
    let key = candidate_key(&path);
    if seen.insert(key) {
        candidates.push(Candidate {
            source: source.into(),
            path,
        });
    }
}

fn validate_candidate(candidate: &Candidate) -> DiscoveryAttempt {
    let display_path = candidate.path.to_string_lossy().to_string();

    let metadata = match std::fs::metadata(&candidate.path) {
        Ok(metadata) => metadata,
        Err(err) => {
            return rejected(
                &candidate.source,
                &display_path,
                format!("Cannot inspect candidate: {err}"),
            );
        }
    };

    if !metadata.is_file() {
        return rejected(&candidate.source, &display_path, "Candidate is not a file");
    }

    if !looks_like_codex_executable(&candidate.path) {
        return rejected(
            &candidate.source,
            &display_path,
            "Candidate file name is not codex/codex.exe",
        );
    }

    let canonical = match std::fs::canonicalize(&candidate.path) {
        Ok(path) => path,
        Err(err) => {
            return rejected(
                &candidate.source,
                &display_path,
                format!("Cannot canonicalize candidate: {err}"),
            );
        }
    };

    match probe_version(&canonical) {
        Ok(version) => DiscoveryAttempt {
            source: candidate.source.clone(),
            path: Some(canonical.to_string_lossy().to_string()),
            status: DiscoveryStatus::Accepted,
            detail: version,
        },
        Err(err) => rejected(&candidate.source, &canonical.to_string_lossy(), err),
    }
}

fn probe_version(path: &Path) -> Result<String, String> {
    let mut command = std::process::Command::new(path);
    command.arg(VERSION_ARG);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }

    let output = command
        .output()
        .map_err(|err| format!("Version probe could not start: {err}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = [stdout.as_str(), stderr.as_str()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if !output.status.success() {
        return Err(format!(
            "Version probe exited with {}; output='{}'",
            output.status,
            truncate_detail(&combined)
        ));
    }
    if !combined.to_ascii_lowercase().contains("codex") {
        return Err(format!(
            "Version probe output did not identify Codex; output='{}'",
            truncate_detail(&combined)
        ));
    }

    Ok(truncate_detail(&combined))
}

fn source_unavailable(source: impl Into<String>, detail: impl Into<String>) -> DiscoveryAttempt {
    DiscoveryAttempt {
        source: source.into(),
        path: None,
        status: DiscoveryStatus::SourceUnavailable,
        detail: detail.into(),
    }
}

fn runtime_attempt(attempt: DiscoveryAttempt) -> CodexRuntimeAttempt {
    CodexRuntimeAttempt {
        source: attempt.source,
        path: attempt.path,
        status: match attempt.status {
            DiscoveryStatus::Accepted => "accepted".to_string(),
            DiscoveryStatus::Rejected => "rejected".to_string(),
            DiscoveryStatus::SourceUnavailable => "source_unavailable".to_string(),
        },
        detail: attempt.detail,
    }
}

fn rejected(
    source: impl Into<String>,
    path: impl AsRef<str>,
    detail: impl Into<String>,
) -> DiscoveryAttempt {
    DiscoveryAttempt {
        source: source.into(),
        path: Some(path.as_ref().to_string()),
        status: DiscoveryStatus::Rejected,
        detail: detail.into(),
    }
}

impl CodexDiscoveryError {
    pub fn user_message(&self, purpose: &str) -> String {
        format!(
            "Could not prove a usable Codex executable for {purpose}.\nAxiOwl tried aggressive Codex discovery and rejected every candidate.\n{}",
            format_attempts(&self.attempts)
        )
    }
}

impl CodexRuntime {
    fn brief_report(&self) -> String {
        format!(
            "Codex runtime selected from '{}': '{}' ({}) after {} discovery attempt(s)",
            self.source,
            self.executable.display(),
            self.version,
            self.attempts.len()
        )
    }
}

fn format_attempts(attempts: &[DiscoveryAttempt]) -> String {
    if attempts.is_empty() {
        return "No discovery attempts were recorded.".to_string();
    }

    let mut lines = vec!["Codex discovery report:".to_string()];
    for attempt in attempts {
        lines.push(format!("- {}", format_attempt(attempt)));
    }
    lines.join("\n")
}

fn format_attempt(attempt: &DiscoveryAttempt) -> String {
    let status = match attempt.status {
        DiscoveryStatus::Accepted => "accepted",
        DiscoveryStatus::Rejected => "rejected",
        DiscoveryStatus::SourceUnavailable => "source unavailable",
    };
    match &attempt.path {
        Some(path) => format!(
            "{} -> {}: {} ({})",
            attempt.source, path, status, attempt.detail
        ),
        None => format!("{}: {} ({})", attempt.source, status, attempt.detail),
    }
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "codex.exe"
    } else {
        "codex"
    }
}

fn looks_like_codex_executable(path: &Path) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .map(|name| {
            name.eq_ignore_ascii_case(executable_name()) || name.eq_ignore_ascii_case("codex")
        })
        .unwrap_or(false)
}

fn candidate_key(path: &Path) -> String {
    path.to_string_lossy().to_ascii_lowercase()
}

fn strip_outer_quotes(value: &OsStr) -> String {
    let value = value.to_string_lossy();
    value.trim().trim_matches('"').to_string()
}

fn truncate_detail(value: &str) -> String {
    let value = value.trim();
    if value.chars().count() <= MAX_DETAIL_CHARS {
        return value.to_string();
    }

    let truncated = value.chars().take(MAX_DETAIL_CHARS).collect::<String>();
    format!("{truncated}...")
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

    use super::{
        cache_runtime, cached_runtime_if_valid, candidate_key, looks_like_codex_executable,
        CodexRuntime, DiscoveryAttempt, truncate_detail, RUNTIME_CACHE,
    };
    #[test]
    fn recognizes_codex_executable_names() {
        assert!(looks_like_codex_executable(&PathBuf::from("codex")));
        assert!(looks_like_codex_executable(&PathBuf::from("codex.exe")));
        assert!(!looks_like_codex_executable(&PathBuf::from("node.exe")));
    }

    #[test]
    fn candidate_keys_are_case_insensitive() {
        assert_eq!(
            candidate_key(&PathBuf::from(r"C:\Tools\Codex.EXE")),
            candidate_key(&PathBuf::from(r"c:\tools\codex.exe"))
        );
    }

    #[test]
    fn long_probe_details_are_bounded() {
        let input = "x".repeat(800);
        assert!(truncate_detail(&input).len() < input.len());
    }

    #[test]
    fn runtime_policy_disables_where_exe_helper_discovery() {
        let source = include_str!("codex_runtime.rs");
        assert!(source.contains("Disabled by runtime policy"));
        assert!(!source.contains("Command::new(\"where.exe\")"));
    }

    #[test]
    fn shared_node_discovery_script_also_avoids_where_exe_helper() {
        let source = include_str!("../../scripts/codex-runtime-discovery.cjs");
        assert!(source.contains("Disabled by runtime policy"));
        assert!(!source.contains("spawnSync(\"where.exe\""));
    }

    #[test]
    fn smoke_script_avoids_cmd_wrapper_for_login_status() {
        let source = include_str!("../../scripts/mvp-smoke.ps1");
        assert!(!source.contains("& cmd /c"));
    }

    #[test]
    fn stale_cached_runtime_is_discarded_when_revalidation_fails() {
        let cache = RUNTIME_CACHE.get_or_init(|| std::sync::Mutex::new(None));
        let original = cache.lock().unwrap().clone();
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let fake_dir = std::env::temp_dir().join(format!("axiowl_codex_runtime_test_{unique}"));
        let fake_executable = fake_dir.join(if cfg!(windows) { "codex.exe" } else { "codex" });
        fs::create_dir_all(&fake_dir).unwrap();
        fs::write(&fake_executable, "not a real executable").unwrap();

        cache_runtime(CodexRuntime {
            executable: fake_executable.clone(),
            source: "test".to_string(),
            version: "stale".to_string(),
            attempts: Vec::<DiscoveryAttempt>::new(),
        });

        assert!(cached_runtime_if_valid().is_none());
        assert!(cache.lock().unwrap().is_none());

        let _ = fs::remove_file(&fake_executable);
        let _ = fs::remove_dir(&fake_dir);
        *cache.lock().unwrap() = original;
    }

    #[test]
    fn runtime_status_maps_discovery_attempt_statuses() {
        let status = super::runtime_attempt(DiscoveryAttempt {
            source: "PATH entry".to_string(),
            path: Some("C:\\codex.exe".to_string()),
            status: super::DiscoveryStatus::Rejected,
            detail: "Version probe failed".to_string(),
        });
        assert_eq!(status.status, "rejected");
        assert_eq!(status.source, "PATH entry");
    }
}
