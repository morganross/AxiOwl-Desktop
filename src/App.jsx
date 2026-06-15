import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar/Sidebar';
import ThreadView from './components/ThreadView/ThreadView';
import EditorPane from './components/EditorPane/EditorPane';
import LoginScreen from './components/LoginScreen/LoginScreen';
import { Terminal } from 'lucide-react';
import { desktopApi } from './lib/desktopApi';
import { appendRuntimeDiagnosticsHint } from './lib/runtimeMessaging';
import './App.css';

function isAuthExpiredError(errorText) {
  const normalized = String(errorText || '').toLowerCase();
  return normalized.includes('authentication expired')
    || normalized.includes('token_invalidated')
    || normalized.includes('token_revoked')
    || normalized.includes('refresh_token_invalidated')
    || normalized.includes('invalidated oauth token')
    || normalized.includes('oauth token for user')
    || normalized.includes('please sign in again')
    || normalized.includes('please log in again')
    || normalized.includes('session has ended');
}

function RuntimeDiagnosticsModal({ status, onClose }) {
  if (!status) {
    return null;
  }

  const attempts = Array.isArray(status.attempts) ? status.attempts : [];

  return (
    <div className="about-modal-overlay" onClick={onClose}>
      <div className="about-modal-card runtime-diagnostics-modal" onClick={(e) => e.stopPropagation()}>
        <div className="about-modal-header">
          <Terminal size={28} className="about-logo-icon" />
          <h3>Codex Runtime Diagnostics</h3>
          <span className={`runtime-diagnostics-pill ${status.available ? 'runtime-diagnostics-pill-ok' : 'runtime-diagnostics-pill-error'}`}>
            {status.available ? 'Ready' : 'Unavailable'}
          </span>
        </div>
        <div className="about-modal-body runtime-diagnostics-body">
          <div className="about-details-table">
            <div className="details-row">
              <span className="details-label">Profile:</span>
              <span className="details-value font-mono">{status.codexHome || 'Unknown'}</span>
            </div>
            <div className="details-row">
              <span className="details-label">Executable:</span>
              <span className="details-value font-mono">{status.executable || 'Not proven'}</span>
            </div>
            <div className="details-row">
              <span className="details-label">Source:</span>
              <span className="details-value font-mono">{status.source || 'Unavailable'}</span>
            </div>
            <div className="details-row">
              <span className="details-label">Version:</span>
              <span className="details-value font-mono">{status.version || 'Unavailable'}</span>
            </div>
          </div>

          {status.error && (
            <div className="runtime-diagnostics-error">
              {status.error}
            </div>
          )}

          <div className="runtime-diagnostics-attempts">
            <h4>Discovery Attempts</h4>
            {attempts.length === 0 ? (
              <p className="runtime-diagnostics-empty">No discovery attempts were recorded.</p>
            ) : (
              <div className="runtime-diagnostics-attempt-list">
                {attempts.map((attempt, index) => (
                  <div className="runtime-diagnostics-attempt" key={`${attempt.source}-${attempt.path || 'none'}-${index}`}>
                    <div className="runtime-diagnostics-attempt-header">
                      <span className="runtime-diagnostics-attempt-source">{attempt.source}</span>
                      <span className={`runtime-diagnostics-attempt-status runtime-diagnostics-attempt-status-${attempt.status}`}>
                        {attempt.status}
                      </span>
                    </div>
                    {attempt.path && (
                      <div className="runtime-diagnostics-attempt-path font-mono">{attempt.path}</div>
                    )}
                    <div className="runtime-diagnostics-attempt-detail">{attempt.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="about-modal-footer">
          <button className="about-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const isDesktopRuntime = desktopApi.isTauri();
  const [appInfo, setAppInfo] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [newThreadResetKey, setNewThreadResetKey] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(isDesktopRuntime);
  const [userInfo, setUserInfo] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [codexRuntimeStatus, setCodexRuntimeStatus] = useState(null);
  const [desktopStatusMessage, setDesktopStatusMessage] = useState(null);

  // Layout and dialog states
  const [showSidebar, setShowSidebar] = useState(true);
  const [showEditorPane, setShowEditorPane] = useState(true);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showRuntimeDiagnosticsModal, setShowRuntimeDiagnosticsModal] = useState(false);

  const [activeModel, setActiveModel] = useState(null);
  const [activeContextWindow, setActiveContextWindow] = useState(null);
  const [activeSessionUsage, setActiveSessionUsage] = useState(null);
  const [sessionsError, setSessionsError] = useState(null);
  const [quotaInfo, setQuotaInfo] = useState({
    success: false,
    error: null,
    fiveHourRemaining: null,
    weeklyRemaining: null,
    primaryResetSeconds: null,
    secondaryResetSeconds: null,
    limitId: null,
    limitLabel: null,
    planType: null,
    additionalLimits: [],
  });

  // Editor state
  // openFiles: Array<{ path: string, name: string, content: string }>
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFilePath, setActiveFilePath] = useState(null);
  const [workspaceRefreshTrigger, setWorkspaceRefreshTrigger] = useState(0);

  const triggerWorkspaceRefresh = useCallback(() => {
    setWorkspaceRefreshTrigger(prev => prev + 1);
  }, []);

  // Last terminal output from Codex shell commands (for context injection)
  const lastTerminalOutputRef = useRef('');

  // Load authoritative token usage from the real Codex session file whenever session changes.
  useEffect(() => {
    if (activeSession) {
      setActiveSessionUsage(null);
      setActiveContextWindow(null);
      setActiveModel(null);
      desktopApi.getSessionUsage(activeSession)
        .then((data) => {
          setActiveSessionUsage(data?.totalTokens ?? null);
          if (data?.contextWindow != null) {
            setActiveContextWindow(data.contextWindow);
          }
          if (data?.model) {
            setActiveModel(data.model);
          }
        })
        .catch((err) => {
          console.error('Failed to load session usage:', err);
          setActiveSessionUsage(null);
          setDesktopStatusMessage(
            `Could not load token usage for the active session. ${err.message || 'Session usage lookup failed.'}`
          );
        });
    } else {
      setActiveSessionUsage(null);
    }
  }, [activeSession]);

  // Open a file in the editor
  const handleFileOpen = useCallback(async (absolutePath) => {
    if (!absolutePath) return;
    try {
      const data = await desktopApi.readFile(absolutePath);
      if (data.success) {
        const name = absolutePath.split(/[\\/]/).pop();
        setOpenFiles(prev => {
          const existing = prev.find(f => f.path === absolutePath);
          if (existing) {
            return prev.map(f => f.path === absolutePath ? { ...f, content: data.content } : f);
          }
          return [...prev, { path: absolutePath, name, content: data.content }];
        });
        setActiveFilePath(absolutePath);
        setDesktopStatusMessage(null);
      }
    } catch (err) {
      console.error('[App] Failed to fetch file content:', err);
      setOpenFiles(prev => prev.filter(f => f.path !== absolutePath));
      setActiveFilePath(prev => (prev === absolutePath ? null : prev));
      setDesktopStatusMessage(
        `Could not open ${absolutePath.split(/[\\/]/).pop() || 'the requested file'}. ${err.message || 'File read failed.'}`
      );
    }
  }, []);

  // Refresh an already-open file (e.g. after Codex modifies it)
  const handleFileRefresh = useCallback(async (absolutePath) => {
    if (!absolutePath) return;
    try {
      const data = await desktopApi.readFile(absolutePath);
      if (data.success) {
        setOpenFiles(prev => {
          const existing = prev.find(f => f.path === absolutePath);
          if (existing) {
            return prev.map(f => f.path === absolutePath ? { ...f, content: data.content } : f);
          }
          // If not open yet, open it
          const name = absolutePath.split(/[\\/]/).pop();
          return [...prev, { path: absolutePath, name, content: data.content }];
        });
        setActiveFilePath(absolutePath);
        // Refresh sidebar files list
        triggerWorkspaceRefresh();
        setDesktopStatusMessage(null);
      }
    } catch (err) {
      console.error('[App] Failed to refresh file content:', err);
      setDesktopStatusMessage(
        `Could not refresh ${absolutePath.split(/[\\/]/).pop() || 'the active file'}. ${err.message || 'File reload failed.'}`
      );
    }
  }, [triggerWorkspaceRefresh]);

  // Save a file
  const handleFileSave = useCallback(async (absolutePath, content) => {
    const data = await desktopApi.writeFile(absolutePath, content);
    if (!data.success) throw new Error('Save failed');
    // Update cached content so isDirty resets
    setOpenFiles(prev =>
      prev.map(f => f.path === absolutePath ? { ...f, content } : f)
    );
    // Refresh sidebar files list
    triggerWorkspaceRefresh();
  }, [triggerWorkspaceRefresh]);

  // Close a tab
  const handleTabClose = useCallback((closedPath) => {
    setOpenFiles(prev => {
      const remaining = prev.filter(f => f.path !== closedPath);
      if (activeFilePath === closedPath) {
        setActiveFilePath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
      }
      return remaining;
    });
  }, [activeFilePath]);

  const handleNewWorkspace = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-workspace-create'));
  }, []);

  const handleSelectSession = useCallback((sessionId) => {
    if (sessionId === null) {
      setActiveSession(null);
      setNewThreadResetKey(prev => prev + 1);
      return;
    }
    setActiveSession(sessionId);
  }, []);

  const handleSaveFile = useCallback(() => {
    window.dispatchEvent(new CustomEvent('trigger-file-save'));
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setShowSidebar(prev => !prev);
  }, []);

  const handleToggleEditorPane = useCallback(() => {
    setShowEditorPane(prev => !prev);
  }, []);

  const handleDesktopShortcut = useCallback((event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();
    if (!['b', 'e', 'n', 's'].includes(key)) {
      return;
    }

    event.preventDefault();

    if (key === 'b') {
      handleToggleSidebar();
      return;
    }

    if (key === 'e') {
      handleToggleEditorPane();
      return;
    }

    if (key === 'n') {
      handleNewWorkspace();
      return;
    }

    if (key === 's') {
      handleSaveFile();
    }
  }, [handleNewWorkspace, handleSaveFile, handleToggleEditorPane, handleToggleSidebar]);

  // Listen for native desktop menu actions
  useEffect(() => {
    if (!isDesktopRuntime) return undefined;
    let unsubscribe = null;
    let disposed = false;
    desktopApi.onMenuAction((action) => {
        switch (action) {
          case 'new-workspace':
            handleNewWorkspace();
            break;
          case 'save-file':
            handleSaveFile();
            break;
          case 'toggle-sidebar':
            handleToggleSidebar();
            break;
          case 'toggle-editor':
            handleToggleEditorPane();
            break;
          case 'about-axiowl':
            setShowAboutModal(true);
            break;
          default:
            break;
        }
      }).then((cleanup) => {
        if (disposed) cleanup();
        else unsubscribe = cleanup;
      });
    return () => {
      disposed = true;
      if (unsubscribe) unsubscribe();
    };
  }, [handleNewWorkspace, handleSaveFile, handleToggleSidebar, handleToggleEditorPane, isDesktopRuntime]);

  // Quota fetching
  const fetchQuotaStatus = () => {
    desktopApi.getQuota()
      .then(data => {
        setQuotaInfo({
          success: data.success === true,
          error: data.error ?? null,
          fiveHourRemaining: data.fiveHourRemaining ?? null,
          weeklyRemaining: data.weeklyRemaining ?? null,
          primaryResetSeconds: data.primaryResetSeconds ?? null,
          secondaryResetSeconds: data.secondaryResetSeconds ?? null,
          limitId: data.limitId ?? null,
          limitLabel: data.limitLabel ?? null,
          planType: data.planType ?? null,
          additionalLimits: Array.isArray(data.additionalLimits) ? data.additionalLimits : [],
        });
      })
      .catch(err => {
        console.error('Failed to fetch quota info:', err);
        const message = appendRuntimeDiagnosticsHint(
          err.message || 'Failed to fetch quota status.',
          codexRuntimeStatus,
        );
        if (isAuthExpiredError(err.message || err)) {
          setIsAuthenticated(false);
          setUserInfo(null);
          setAuthError(message || 'Authentication expired. Please sign in again.');
        }
        setQuotaInfo({
          success: false,
          error: message,
          fiveHourRemaining: null,
          weeklyRemaining: null,
          primaryResetSeconds: null,
          secondaryResetSeconds: null,
          limitId: null,
          limitLabel: null,
          planType: null,
          additionalLimits: [],
        });
      });
  };

  const fetchCodexRuntimeStatus = useCallback(() => {
    return desktopApi.getCodexRuntimeStatus()
      .then((status) => {
        setCodexRuntimeStatus(status);
        return status;
      })
      .catch((err) => {
        console.error('Failed to fetch Codex runtime status:', err);
        const fallback = {
          available: false,
          codexHome: '',
          executable: null,
          source: null,
          version: null,
          attempts: [],
          error: err.message || 'Failed to load Codex runtime status.',
        };
        setCodexRuntimeStatus(fallback);
        return fallback;
      });
  }, []);

  const refreshSessions = () => {
    desktopApi.getSessions()
      .then(data => {
        setSessions(data);
        setSessionsError(null);
      })
      .catch(err => {
        console.error('Failed to load sessions:', err);
        setSessionsError(
          `Could not load historical sessions. ${err.message || 'Session index refresh failed.'}`
        );
      });
  };

  const fetchAuthStatus = () => {
    return desktopApi.getAuthStatus()
      .then(data => {
        setIsAuthenticated(data.authenticated);
        setAuthError(data.error || null);
        if (data.authenticated) {
          setUserInfo({
            method: data.method,
            name: data.name,
            email: data.email,
            plan: data.plan,
            subscriptionActiveUntil: data.subscriptionActiveUntil
          });
        } else {
          setUserInfo(null);
        }
        setIsLoadingAuth(false);
        return data;
      })
      .catch(err => {
        console.error('Failed to fetch auth status', err);
        setAuthError(appendRuntimeDiagnosticsHint(
          err.message || 'Failed to fetch auth status.',
          codexRuntimeStatus,
        ));
        setIsLoadingAuth(false);
        return null;
      });
  };

  const handleLoginSuccess = useCallback(async () => {
    const status = await fetchAuthStatus();
    await fetchCodexRuntimeStatus();
    if (status?.authenticated) {
      setAuthError(null);
      fetchQuotaStatus();
      refreshSessions();
    }
  }, [fetchCodexRuntimeStatus]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      setIsLoadingAuth(false);
      return undefined;
    }
    desktopApi.getAppInfo()
      .then((info) => setAppInfo(info))
      .catch((err) => {
        console.error('Failed to load app info:', err);
        setDesktopStatusMessage(
          `Could not load desktop app metadata. ${err.message || 'App info lookup failed.'}`
        );
      });
    fetchCodexRuntimeStatus();
    fetchAuthStatus().then((status) => {
      if (status?.authenticated) {
        refreshSessions();
        fetchQuotaStatus();
      }
    });
    const quotaInterval = setInterval(() => {
      fetchQuotaStatus();
      fetchCodexRuntimeStatus();
    }, 30000);
    const sessionsInterval = setInterval(refreshSessions, 4000);
    return () => {
      clearInterval(quotaInterval);
      clearInterval(sessionsInterval);
    };
  }, [fetchCodexRuntimeStatus, isDesktopRuntime]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return undefined;
    }

    window.addEventListener('keydown', handleDesktopShortcut);
    return () => {
      window.removeEventListener('keydown', handleDesktopShortcut);
    };
  }, [handleDesktopShortcut, isDesktopRuntime]);

  // On mount, check startup options and listen for IPC open-path events
  useEffect(() => {
    if (!isDesktopRuntime) return undefined;
    // 1. Consume initial startup options
    desktopApi.getStartupOptions()
      .then(data => {
        if (data.initialFile) {
          handleFileOpen(data.initialFile);
        }
      })
      .catch(err => {
        console.error('[App] Failed to fetch startup options:', err);
        setDesktopStatusMessage(
          `Could not load startup file selection. ${err.message || 'Startup options lookup failed.'}`
        );
      });

    // 2. Listen for second-instance open path requests
    let unsubscribe = null;
    let disposed = false;
    desktopApi.onOpenPath(async (targetPath) => {
        try {
          const data = await desktopApi.openPath(targetPath);
          if (data.success) {
            // Reset active tabs to prevent leakage
            setOpenFiles([]);
            setActiveFilePath(null);
            
            // Trigger UI refresh
            triggerWorkspaceRefresh();
            
            // If it resolved to a file, open it in the editor
            if (data.file) {
              await handleFileOpen(data.file);
            }
            setDesktopStatusMessage(null);
          }
        } catch (err) {
          console.error('[App] Failed to process open-path request:', err);
          setDesktopStatusMessage(
            `Could not open the requested path. ${err.message || 'Open-path handling failed.'}`
          );
        }
      }).then((cleanup) => {
        if (disposed) cleanup();
        else unsubscribe = cleanup;
      });
    return () => {
      disposed = true;
      if (unsubscribe) unsubscribe();
    };
  }, [handleFileOpen, triggerWorkspaceRefresh, isDesktopRuntime]);

  const handleLogout = () => {
    desktopApi.triggerLogout()
      .then(data => {
        if (data.success) {
          setIsAuthenticated(false);
          setUserInfo(null);
          setAuthError(null);
          setDesktopStatusMessage(null);
        }
      })
      .catch(err => {
        console.error('Failed to logout', err);
        setDesktopStatusMessage(
          `Could not sign out of Codex. ${err.message || 'Logout failed.'}`
        );
      });
  };

  const handleAuthExpired = useCallback((message) => {
    setIsAuthenticated(false);
    setUserInfo(null);
    setAuthError(message || 'Authentication expired. Please sign in again.');
  }, []);

  // Derive active file content for context injection into prompts
  const activeFileContent = openFiles.find(f => f.path === activeFilePath)?.content ?? null;
  const activeFilePathProp = activeFilePath;

  if (!isDesktopRuntime) {
    return (
      <div style={{ height: '100vh', width: '100vw', background: '#0f0f11', color: '#f4f4f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px' }}>
        <div style={{ maxWidth: '640px', textAlign: 'center' }}>
          <Terminal size={40} style={{ marginBottom: '16px' }} />
          <h1 style={{ marginBottom: '12px' }}>Tauri Runtime Required</h1>
          <p style={{ lineHeight: 1.6, opacity: 0.86 }}>
            AxiOwl now runs only inside the Tauri desktop runtime. Browser mode and legacy local API mode were removed during the refactor.
          </p>
        </div>
      </div>
    );
  }

  if (isLoadingAuth) {
    return <div style={{ height: '100vh', width: '100vw', background: '#0f0f11' }} />;
  }

  if (!isAuthenticated) {
    return (
      <div className="app-viewport">
        <LoginScreen
          onLoginSuccess={handleLoginSuccess}
          initialError={authError}
          codexRuntimeStatus={codexRuntimeStatus}
          onViewRuntimeDiagnostics={() => setShowRuntimeDiagnosticsModal(true)}
        />
        {showRuntimeDiagnosticsModal && (
          <RuntimeDiagnosticsModal
            status={codexRuntimeStatus}
            onClose={() => setShowRuntimeDiagnosticsModal(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="app-viewport">
      {desktopStatusMessage && (
        <div className="desktop-status-banner error">
          {desktopStatusMessage}
        </div>
      )}
      <div className={`app-container desktop-mode ${showSidebar ? '' : 'sidebar-hidden'} ${showEditorPane ? '' : 'editor-hidden'}`}>
        <div className="sidebar-region">
          <Sidebar
            sessions={sessions}
            activeSession={activeSession}
            onSelectSession={handleSelectSession}
            userInfo={userInfo}
            onLogout={handleLogout}
            quotaInfo={quotaInfo}
            codexRuntimeStatus={codexRuntimeStatus}
            onViewRuntimeDiagnostics={() => setShowRuntimeDiagnosticsModal(true)}
            sessionsError={sessionsError}
            workspaceRefreshKey={workspaceRefreshTrigger}
            onWorkspaceChange={() => {
              setOpenFiles([]);
              setActiveFilePath(null);
              triggerWorkspaceRefresh();
            }}
          />
        </div>
        <div className="main-region">
          <ThreadView
            activeSession={activeSession}
            newThreadResetKey={newThreadResetKey}
            sessions={sessions}
            onSessionCreated={(uuid) => {
              setActiveSession(uuid);
              refreshSessions();
            }}
            onSessionFinished={() => {
              refreshSessions();
              fetchQuotaStatus();
              triggerWorkspaceRefresh();
            }}
            onFileOpen={handleFileRefresh}
            onTerminalOutput={(output) => {
              lastTerminalOutputRef.current = output;
            }}
            activeFileContent={activeFileContent}
            activeFilePath={activeFilePathProp}
            lastTerminalOutputRef={lastTerminalOutputRef}
            onModelInfoChanged={(modelSlug, contextWindow) => {
              setActiveModel(modelSlug);
              if (contextWindow != null || !activeSession) {
                setActiveContextWindow(contextWindow);
              }
            }}
            onTokenUsageUpdated={(usage) => {
              setActiveSessionUsage(usage);
            }}
            onAuthExpired={handleAuthExpired}
            activeModel={activeModel}
            activeContextWindow={activeContextWindow}
            activeSessionUsage={activeSessionUsage}
            codexRuntimeStatus={codexRuntimeStatus}
          />
        </div>
        <div className="editor-region">
          <EditorPane
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            onTabSelect={setActiveFilePath}
            onTabClose={handleTabClose}
            onFileSave={handleFileSave}
            onFileOpen={handleFileOpen}
            refreshTrigger={workspaceRefreshTrigger}
          />
        </div>
      </div>

      {/* About Modal Dialog */}
      {showAboutModal && (
        <div className="about-modal-overlay" onClick={() => setShowAboutModal(false)}>
          <div className="about-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="about-modal-header">
              <Terminal size={32} className="about-logo-icon" />
              <h3>AxiOwl Desktop</h3>
              {appInfo?.version && (
                <span className="about-version">Version {appInfo.version}</span>
              )}
            </div>
            <div className="about-modal-body">
              <p>
                AxiOwl is a Tauri desktop application for local workspace editing, Codex execution, session history, and native desktop integration.
              </p>
              <div className="about-details-table">
                <div className="details-row">
                  <span className="details-label">Engine:</span>
                  <span className="details-value font-mono">Tauri + React + Rust</span>
                </div>
                <div className="details-row">
                  <span className="details-label">Workspace:</span>
                  <span className="details-value font-mono">Sibling Directory Scoping</span>
                </div>
              </div>
            </div>
            <div className="about-modal-footer">
              <button className="about-close-btn" onClick={() => setShowAboutModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showRuntimeDiagnosticsModal && (
        <RuntimeDiagnosticsModal
          status={codexRuntimeStatus}
          onClose={() => setShowRuntimeDiagnosticsModal(false)}
        />
      )}
    </div>
  );
}

export default App;
