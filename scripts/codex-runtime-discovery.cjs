const fs = require("fs");
const path = require("path");
const MAX_DETAIL_CHARS = 600;

function discoverCodexRuntime() {
  const attempts = [];
  const candidates = [];
  const seen = new Set();

  for (const name of ["AXIOWL_CODEX_EXE", "CAM_CODEX_EXE", "CODEX_EXE", "OPENAI_CODEX_EXE"]) {
    const value = process.env[name];
    if (value && value.trim()) {
      pushCandidate(candidates, seen, `environment variable ${name}`, stripOuterQuotes(value));
    } else {
      attempts.push(sourceUnavailable(`environment variable ${name}`, "Variable is not set or empty"));
    }
  }

  collectLocalAppDataCandidates(candidates, seen, attempts);
  collectPathCandidates(candidates, seen, attempts);
  collectWhereCandidates(attempts);
  collectWindowsAppsCandidates(candidates, seen, attempts);

  let selected = null;
  for (const candidate of candidates) {
    const attempt = validateCandidate(candidate);
    attempts.push(attempt);
    if (!selected && attempt.status === "accepted") {
      selected = {
        path: attempt.path,
        source: candidate.source,
        version: attempt.detail,
      };
    }
  }

  if (!selected) {
    const error = new Error(`Could not prove a usable Codex executable.\n${formatDiscoveryReport(attempts)}`);
    error.attempts = attempts;
    throw error;
  }

  return {
    ...selected,
    attempts,
  };
}

function collectLocalAppDataCandidates(candidates, seen, attempts) {
  if (!process.env.LOCALAPPDATA) {
    attempts.push(sourceUnavailable("LOCALAPPDATA OpenAI Codex bin", "LOCALAPPDATA is not set"));
    return;
  }

  const binDir = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
  pushCandidate(candidates, seen, "LOCALAPPDATA OpenAI Codex bin", path.join(binDir, executableName()));

  try {
    for (const entry of fs.readdirSync(binDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        pushCandidate(
          candidates,
          seen,
          "LOCALAPPDATA OpenAI Codex versioned bin",
          path.join(binDir, entry.name, executableName()),
        );
      }
    }
  } catch (error) {
    attempts.push(sourceUnavailable("LOCALAPPDATA OpenAI Codex versioned bin", error.message));
  }
}

function collectPathCandidates(candidates, seen, attempts) {
  const pathValue = process.env.PATH || "";
  if (!pathValue.trim()) {
    attempts.push(sourceUnavailable("PATH", "PATH is not set or empty"));
    return;
  }

  for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
    pushCandidate(candidates, seen, "PATH entry", path.join(entry, executableName()));
  }
}

function collectWhereCandidates(attempts) {
  attempts.push(
    sourceUnavailable(
      "where.exe codex",
      "Disabled by runtime policy; PATH entries are scanned directly without launching shell helpers",
    ),
  );
}

function collectWindowsAppsCandidates(candidates, seen, attempts) {
  if (process.platform !== "win32") {
    attempts.push(sourceUnavailable("WindowsApps OpenAI.Codex package resources", "WindowsApps discovery is Windows-only"));
    return;
  }

  for (const envName of ["ProgramFiles", "ProgramW6432"]) {
    const programFiles = process.env[envName];
    if (!programFiles) {
      attempts.push(sourceUnavailable(`${envName} WindowsApps Codex package`, `${envName} is not set`));
      continue;
    }

    const windowsApps = path.join(programFiles, "WindowsApps");
    try {
      for (const entry of fs.readdirSync(windowsApps, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith("OpenAI.Codex_")) {
          pushCandidate(
            candidates,
            seen,
            "WindowsApps OpenAI.Codex package resources",
            path.join(windowsApps, entry.name, "app", "resources", executableName()),
          );
        }
      }
    } catch (error) {
      attempts.push(sourceUnavailable(`${envName} WindowsApps Codex package`, error.message));
    }
  }
}

function validateCandidate(candidate) {
  let stats;
  try {
    stats = fs.statSync(candidate.path);
  } catch (error) {
    return rejected(candidate.source, candidate.path, `Cannot inspect candidate: ${error.message}`);
  }

  if (!stats.isFile()) {
    return rejected(candidate.source, candidate.path, "Candidate is not a file");
  }

  if (!looksLikeCodexExecutable(candidate.path)) {
    return rejected(candidate.source, candidate.path, "Candidate file name is not codex/codex.exe");
  }

  let realPath;
  try {
    realPath = fs.realpathSync(candidate.path);
  } catch (error) {
    return rejected(candidate.source, candidate.path, `Cannot canonicalize candidate: ${error.message}`);
  }

  const probe = spawnSync(realPath, ["--version"], { encoding: "utf8", timeout: 10000 });
  if (probe.error) {
    return rejected(candidate.source, realPath, `Version probe could not start: ${probe.error.message}`);
  }

  const output = [probe.stdout, probe.stderr].filter(Boolean).join("\n").trim();
  if (probe.status !== 0) {
    return rejected(candidate.source, realPath, `Version probe exited with ${probe.status}; output='${truncateDetail(output)}'`);
  }

  if (!output.toLowerCase().includes("codex")) {
    return rejected(candidate.source, realPath, `Version probe output did not identify Codex; output='${truncateDetail(output)}'`);
  }

  return {
    source: candidate.source,
    path: realPath,
    status: "accepted",
    detail: truncateDetail(output),
  };
}

function pushCandidate(candidates, seen, source, candidatePath) {
  const key = String(candidatePath).toLowerCase();
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push({ source, path: candidatePath });
}

function sourceUnavailable(source, detail) {
  return {
    source,
    path: null,
    status: "source unavailable",
    detail,
  };
}

function rejected(source, candidatePath, detail) {
  return {
    source,
    path: candidatePath,
    status: "rejected",
    detail,
  };
}

function formatDiscoveryReport(attempts) {
  return [
    "Codex discovery report:",
    ...attempts.map((attempt) => {
      const location = attempt.path ? ` -> ${attempt.path}` : "";
      return `- ${attempt.source}${location}: ${attempt.status} (${attempt.detail})`;
    }),
  ].join("\n");
}

function executableName() {
  return process.platform === "win32" ? "codex.exe" : "codex";
}

function looksLikeCodexExecutable(candidatePath) {
  const base = path.basename(candidatePath).toLowerCase();
  return base === "codex.exe" || base === "codex";
}

function stripOuterQuotes(value) {
  return String(value).trim().replace(/^"+|"+$/g, "");
}

function truncateDetail(value) {
  const text = String(value || "").trim();
  if (text.length <= MAX_DETAIL_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_DETAIL_CHARS)}...`;
}

if (require.main === module) {
  try {
    const runtime = discoverCodexRuntime();
    console.log(JSON.stringify(runtime, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  discoverCodexRuntime,
  formatDiscoveryReport,
};
