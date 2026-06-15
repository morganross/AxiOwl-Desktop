import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const hasTauri = () => typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
const runtimeError = 'AxiOwl must be launched inside the Tauri desktop runtime.';

async function call(command, args) {
  if (!hasTauri()) {
    throw new Error(`${runtimeError} Unsupported command: ${command}`);
  }
  try {
    return await invoke(command, args);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
    throw new Error(message || `Tauri command failed: ${command}`);
  }
}

function expectObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid response shape.`);
  }
  return value;
}

function expectArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} returned an invalid response shape.`);
  }
  return value;
}

function normalizeEnvelope(envelope) {
  if (!envelope) return { type: 'error', error: 'Missing process event' };
  if (envelope.type === 'codex_json' || envelope.eventType === 'codex_json') {
    return envelope.payload;
  }
  if (envelope.type === 'exit' || envelope.eventType === 'exit') {
    if (envelope.payload?.cancelled) {
      return {
        type: 'cancelled',
        exitCode: envelope.payload?.exitCode ?? null,
      };
    }
    if (envelope.payload?.type === 'error') {
      return envelope.payload;
    }
    if (envelope.payload?.success === false) {
      const exitCode = envelope.payload?.exitCode;
      return {
        type: 'error',
        error: exitCode == null
          ? 'Codex exited unsuccessfully.'
          : `Codex exited with status ${exitCode}.`
      };
    }
    return { type: 'end', exitCode: envelope.payload?.exitCode ?? null };
  }
  if (envelope.type === 'stderr' || envelope.eventType === 'stderr') {
    return {
      type: 'stderr_message',
      content: envelope.payload?.content ?? '',
    };
  }
  if (envelope.type === 'stdout' || envelope.eventType === 'stdout') {
    return envelope.payload || { type: 'message', content: '' };
  }
  if (envelope.type === 'error' || envelope.eventType === 'error') {
    return envelope.payload || { type: 'error', error: 'Unknown run error' };
  }
  return envelope.payload || envelope;
}

export const desktopApi = {
  isDesktop() {
    return hasTauri();
  },

  isTauri() {
    return hasTauri();
  },

  async getAppInfo() {
    return expectObject(await call('get_app_info'), 'get_app_info');
  },

  getAuthStatus() {
    return call('get_auth_status').then((result) => expectObject(result, 'get_auth_status'));
  },

  getCodexRuntimeStatus() {
    return call('get_codex_runtime_status').then((result) => expectObject(result, 'get_codex_runtime_status'));
  },

  triggerLogin() {
    return call('trigger_login');
  },

  triggerLogout() {
    return call('trigger_logout');
  },

  getQuota() {
    return call('get_quota').then((result) => expectObject(result, 'get_quota'));
  },

  getStartupOptions() {
    return call('get_startup_options').then((result) => expectObject(result, 'get_startup_options'));
  },

  openPath(path) {
    return call('open_path', { path }).then((result) => expectObject(result, 'open_path'));
  },

  getWorkspaces() {
    return call('get_sibling_workspaces').then((result) => {
      const value = expectObject(result, 'get_sibling_workspaces');
      expectArray(value.workspaces, 'get_sibling_workspaces.workspaces');
      return value;
    });
  },

  selectWorkspace(name) {
    return call('select_workspace', { name }).then((result) => expectObject(result, 'select_workspace'));
  },

  createWorkspace(name) {
    return call('create_workspace', { name }).then((result) => expectObject(result, 'create_workspace'));
  },

  async getWorkspaceFiles() {
    const result = expectObject(await call('get_workspace_files'), 'get_workspace_files');
    return expectArray(result.files, 'get_workspace_files.files');
  },

  readFile(path) {
    return call('read_file', { path }).then((result) => expectObject(result, 'read_file'));
  },

  writeFile(path, content) {
    return call('write_file', { path, content }).then((result) => expectObject(result, 'write_file'));
  },

  createFile(relativePath) {
    return call('create_file', { relativePath }).then((result) => expectObject(result, 'create_file'));
  },

  getSessions() {
    return call('get_historical_sessions').then((result) => expectArray(result, 'get_historical_sessions'));
  },

  readSessionHistory(sessionUuid) {
    return call('read_session_history', { sessionUuid }).then((result) => expectArray(result, 'read_session_history'));
  },

  getSessionUsage(sessionUuid) {
    return call('get_session_usage', { sessionUuid }).then((result) => expectObject(result, 'get_session_usage'));
  },

  getModels() {
    return call('get_models').then((result) => expectArray(result, 'get_models'));
  },

  executePrompt({ prompt, sessionUuid, model, reasoning, speed }) {
    return call('execute_prompt', { prompt, sessionUuid, model, reasoning, speed })
      .then((result) => expectObject(result, 'execute_prompt'));
  },

  approveRun(runId) {
    return call('approve_run', { runId }).then((result) => expectObject(result, 'approve_run'));
  },

  cancelRun(runId) {
    return call('cancel_run', { runId }).then((result) => expectObject(result, 'cancel_run'));
  },

  async onCodexEvent(callback) {
    if (!hasTauri()) {
      return () => {};
    }
    return listen('codex-event', (event) => callback(event.payload));
  },

  normalizeCodexEvent: normalizeEnvelope,

  async onOpenPath(callback) {
    if (!hasTauri()) return () => {};
    return listen('open-path', (event) => callback(event.payload));
  },

  async onMenuAction(callback) {
    if (!hasTauri()) return () => {};
    return listen('menu-action', (event) => callback(event.payload));
  },

  minimizeWindow() {
    return call('minimize_window');
  },

  toggleMaximizeWindow() {
    return call('toggle_maximize_window');
  },

  closeWindow() {
    return call('close_window');
  },

  toggleFullscreenWindow() {
    return call('toggle_fullscreen_window');
  },
};
