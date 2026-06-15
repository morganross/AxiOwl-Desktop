export function isRuntimeUnavailable(runtimeStatus) {
  return Boolean(runtimeStatus) && runtimeStatus.available === false;
}

export function appendRuntimeDiagnosticsHint(message, runtimeStatus) {
  const base = typeof message === 'string' && message.trim()
    ? message.trim()
    : 'Codex runtime is unavailable.';

  if (!isRuntimeUnavailable(runtimeStatus)) {
    return base;
  }

  const hint = 'Open Codex Runtime diagnostics for discovery details.';
  return base.includes(hint) ? base : `${base} ${hint}`;
}
