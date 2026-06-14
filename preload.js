const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  codexExec: (payload) => ipcRenderer.send('codex-exec', payload),
  codexApprove: () => ipcRenderer.send('codex-exec-approve'),
  getSessions: () => ipcRenderer.invoke('codex-get-sessions'),
  onCodexReply: (callback) => ipcRenderer.on('codex-exec-reply', (event, data) => callback(data)),
  onCodexEnd: (callback) => ipcRenderer.on('codex-exec-end', () => callback()),
  onOpenPath: (callback) => {
    const listener = (event, path) => callback(path);
    ipcRenderer.on('open-path', listener);
    return () => ipcRenderer.removeListener('open-path', listener);
  },
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  toggleFullScreen: () => ipcRenderer.send('window-fullscreen'),
  onMenuAction: (callback) => {
    const listener = (event, action) => callback(action);
    ipcRenderer.on('menu-action', listener);
    return () => ipcRenderer.removeListener('menu-action', listener);
  }
});
