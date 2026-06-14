import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar/Sidebar';
import ThreadView from './components/ThreadView/ThreadView';
import EditorPane from './components/EditorPane/EditorPane';
import LoginScreen from './components/LoginScreen/LoginScreen';
import TitleBar from './components/TitleBar/TitleBar';
import { Terminal } from 'lucide-react';
import './App.css';

function App() {
  const [activeSession, setActiveSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [userInfo, setUserInfo] = useState(null);

  // Layout and dialog states
  const [showSidebar, setShowSidebar] = useState(true);
  const [showReviewPane, setShowReviewPane] = useState(true);
  const [showAboutModal, setShowAboutModal] = useState(false);

  const [activeModel, setActiveModel] = useState('gpt-5.4-mini');
  const [activeContextWindow, setActiveContextWindow] = useState(272000);
  const [activeSessionUsage, setActiveSessionUsage] = useState(0);
  const [quotaInfo, setQuotaInfo] = useState({
    fiveHourRemaining: 100,
    weeklyRemaining: 100,
    primaryResetSeconds: null,
    secondaryResetSeconds: null
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

  // Sync token usage from local storage whenever session changes
  useEffect(() => {
    if (activeSession) {
      const savedUsage = parseInt(localStorage.getItem(`axiowl_usage_${activeSession}`) || '0', 10);
      setActiveSessionUsage(savedUsage);
    } else {
      setActiveSessionUsage(0);
    }
  }, [activeSession]);

  // Open a file in the editor
  const handleFileOpen = useCallback(async (absolutePath) => {
    if (!absolutePath) return;
    // If already open, just switch to it
    setOpenFiles(prev => {
      const existing = prev.find(f => f.path === absolutePath);
      if (existing) return prev;
      // Placeholder while loading
      const name = absolutePath.split(/[\\/]/).pop();
      return [...prev, { path: absolutePath, name, content: '' }];
    });
    setActiveFilePath(absolutePath);

    // Fetch actual content
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(absolutePath)}`);
      const data = await res.json();
      if (data.success) {
        setOpenFiles(prev =>
          prev.map(f => f.path === absolutePath ? { ...f, content: data.content } : f)
        );
      }
    } catch (err) {
      console.error('[App] Failed to fetch file content:', err);
    }
  }, []);

  // Refresh an already-open file (e.g. after Codex modifies it)
  const handleFileRefresh = useCallback(async (absolutePath) => {
    if (!absolutePath) return;
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(absolutePath)}`);
      const data = await res.json();
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
      }
    } catch (err) {
      console.error('[App] Failed to refresh file content:', err);
    }
  }, [triggerWorkspaceRefresh]);

  // Save a file
  const handleFileSave = useCallback(async (absolutePath, content) => {
    const res = await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absolutePath, content })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Save failed');
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
    const name = prompt('Enter new workspace name:');
    if (!name || !name.trim()) return;
    fetch('/api/workspace/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() })
    })
      .then(res => res.json())
      .then(data => {
        if (data.root && !data.error) {
          setOpenFiles([]);
          setActiveFilePath(null);
          triggerWorkspaceRefresh();
        } else {
          alert(data.error || 'Failed to create workspace');
        }
      })
      .catch(err => {
        alert('Failed to create workspace: ' + err.message);
      });
  }, [triggerWorkspaceRefresh]);

  const handleSaveFile = useCallback(() => {
    window.dispatchEvent(new CustomEvent('trigger-file-save'));
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setShowSidebar(prev => !prev);
  }, []);

  const handleToggleReviewPane = useCallback(() => {
    setShowReviewPane(prev => !prev);
  }, []);

  // Listen for native Electron menu actions
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onMenuAction) {
      const unsubscribe = window.electronAPI.onMenuAction((action) => {
        console.log('[App] Menu action received via Electron IPC:', action);
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
            handleToggleReviewPane();
            break;
          case 'about-axiowl':
            setShowAboutModal(true);
            break;
          default:
            break;
        }
      });
      return unsubscribe;
    }
  }, [handleNewWorkspace, handleSaveFile, handleToggleSidebar, handleToggleReviewPane]);

  // Quota fetching
  const fetchQuotaStatus = () => {
    fetch('/api/quota')
      .then(res => res.json())
      .then(data => {
        setQuotaInfo({
          fiveHourRemaining: data.fiveHourRemaining ?? 100,
          weeklyRemaining: data.weeklyRemaining ?? 100,
          primaryResetSeconds: data.primaryResetSeconds ?? null,
          secondaryResetSeconds: data.secondaryResetSeconds ?? null
        });
      })
      .catch(err => console.error('Failed to fetch quota info:', err));
  };

  const refreshSessions = () => {
    fetch('/api/sessions')
      .then(res => res.json())
      .then(data => setSessions(data))
      .catch(err => console.error('Failed to load sessions:', err));
  };

  const fetchAuthStatus = () => {
    return fetch('/api/auth/status')
      .then(res => res.json())
      .then(data => {
        setIsAuthenticated(data.authenticated);
        if (data.authenticated) {
          setUserInfo({
            name: data.name,
            email: data.email,
            plan: data.plan,
            subscriptionActiveUntil: data.subscriptionActiveUntil
          });
        } else {
          setUserInfo(null);
        }
        setIsLoadingAuth(false);
      })
      .catch(err => {
        console.error('Failed to fetch auth status', err);
        setIsLoadingAuth(false);
      });
  };

  useEffect(() => {
    fetchAuthStatus();
    refreshSessions();
    fetchQuotaStatus();
    const quotaInterval = setInterval(fetchQuotaStatus, 30000);
    const sessionsInterval = setInterval(refreshSessions, 4000);
    return () => {
      clearInterval(quotaInterval);
      clearInterval(sessionsInterval);
    };
  }, []);

  // On mount, check startup options and listen for IPC open-path events
  useEffect(() => {
    // 1. Consume initial startup options
    fetch('/api/startup-options')
      .then(res => res.json())
      .then(data => {
        if (data.initialFile) {
          handleFileOpen(data.initialFile);
        }
      })
      .catch(err => console.error('[App] Failed to fetch startup options:', err));

    // 2. Listen for second-instance open path requests
    if (window.electronAPI && window.electronAPI.onOpenPath) {
      const unsubscribe = window.electronAPI.onOpenPath(async (targetPath) => {
        console.log('[App] Received IPC open-path event:', targetPath);
        try {
          const res = await fetch('/api/open-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: targetPath })
          });
          const data = await res.json();
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
          }
        } catch (err) {
          console.error('[App] Failed to process open-path request:', err);
        }
      });
      return unsubscribe;
    }
  }, [handleFileOpen, triggerWorkspaceRefresh]);

  const handleLogout = () => {
    fetch('/api/auth/logout', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setIsAuthenticated(false);
          setUserInfo(null);
        }
      })
      .catch(err => console.error('Failed to logout', err));
  };

  // Derive active file content for context injection into prompts
  const activeFileContent = openFiles.find(f => f.path === activeFilePath)?.content ?? null;
  const activeFilePathProp = activeFilePath;

  if (isLoadingAuth) {
    return <div style={{ height: '100vh', width: '100vw', background: '#0f0f11' }} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={fetchAuthStatus} />;
  }

  return (
    <div className="app-viewport">
      {!window.electronAPI && (
        <TitleBar
          showSidebar={showSidebar}
          showReviewPane={showReviewPane}
          onToggleSidebar={handleToggleSidebar}
          onToggleReviewPane={handleToggleReviewPane}
          onSaveFile={handleSaveFile}
          activeFilePath={activeFilePath}
          onNewWorkspace={handleNewWorkspace}
          onShowAbout={() => setShowAboutModal(true)}
        />
      )}
      <div className={`app-container ${window.electronAPI ? 'desktop-mode' : 'web-mode'} ${showSidebar ? '' : 'sidebar-hidden'} ${showReviewPane ? '' : 'review-hidden'}`}>
        <div className="sidebar-region">
          <Sidebar
            sessions={sessions}
            activeSession={activeSession}
            onSelectSession={setActiveSession}
            userInfo={userInfo}
            onLogout={handleLogout}
            quotaInfo={quotaInfo}
            onWorkspaceChange={() => {
              setOpenFiles([]);
              setActiveFilePath(null);
            }}
          />
        </div>
        <div className="main-region">
          <ThreadView
            activeSession={activeSession}
            sessions={sessions}
            onSessionCreated={(uuid, initialPrompt) => {
              console.log('[App.jsx] onSessionCreated called with uuid:', uuid, 'prompt:', initialPrompt);
              setActiveSession(uuid);
              const title = initialPrompt && initialPrompt.length > 25
                ? initialPrompt.substring(0, 25) + '...'
                : (initialPrompt || 'Untitled Session');
              const optimisticSession = { uuid, title, updatedAt: Date.now() };
              setSessions(prev => {
                const filtered = prev.filter(s => s.uuid !== uuid);
                return [optimisticSession, ...filtered].slice(0, 15);
              });
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
              setActiveContextWindow(contextWindow);
            }}
            onTokenUsageUpdated={(usage) => {
              setActiveSessionUsage(usage);
            }}
            activeModel={activeModel}
            activeContextWindow={activeContextWindow}
            activeSessionUsage={activeSessionUsage}
          />
        </div>
        <div className="review-region">
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
              <h3>AxiOwl Developer Studio</h3>
              <span className="about-version">Version 0.1.0 (Beta)</span>
            </div>
            <div className="about-modal-body">
              <p>
                AxiOwl is a premium, AI-powered desktop development cockpit designed by the Google DeepMind team. It provides context-aware command line execution, automated file diff editing, and code compilation pipelines.
              </p>
              <div className="about-details-table">
                <div className="details-row">
                  <span className="details-label">Engine:</span>
                  <span className="details-value font-mono">Electron + React + Express</span>
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
    </div>
  );
}

export default App;
