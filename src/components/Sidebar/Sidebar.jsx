import React, { useEffect, useState } from 'react';
import { Folder, Search, Settings, MessageSquare, Terminal, FileCode, Loader2, Plus } from 'lucide-react';
import './Sidebar.css';

function formatResetTime(seconds) {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function Sidebar({ sessions, activeSession, onSelectSession, userInfo, onLogout, quotaInfo, onWorkspaceChange }) {
  console.log('[Sidebar] rendering with sessions:', sessions.map(s => s.title));
  const [workspaceName, setWorkspaceName] = useState('Loading...');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  const refreshWorkspaceData = () => {
    fetch('/api/workspaces')
      .then(res => res.json())
      .then(data => {
        setWorkspaceName(data.active);
        setWorkspaceRoot(data.root || '');
        setWorkspaces(data.workspaces || []);
      })
      .catch(err => setWorkspaceName('Unknown Workspace'));
  };

  useEffect(() => {
    refreshWorkspaceData();
  }, []);

  const handleWorkspaceSelect = (name) => {
    fetch('/api/workspace/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
      .then(res => res.json())
      .then(data => {
        if (data.root && !data.error) {
          setWorkspaceName(data.name);
          setWorkspaceRoot(data.root);
          if (onWorkspaceChange) {
            onWorkspaceChange();
          }
          // Refresh files list
          fetch('/api/workspace/files')
            .then(res => res.json())
            .then(filesData => setFiles(filesData))
            .catch(() => {});
        } else {
          alert(data.error || 'Failed to select workspace');
        }
      })
      .catch(err => {
        alert('Failed to select workspace: ' + err.message);
      });
  };

  const handleWorkspaceCreate = () => {
    if (!newWorkspaceName.trim()) return;
    fetch('/api/workspace/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newWorkspaceName })
    })
      .then(res => res.json())
      .then(data => {
        if (data.root && !data.error) {
          setWorkspaceName(data.name);
          setWorkspaceRoot(data.root);
          setIsCreatingWorkspace(false);
          setNewWorkspaceName('');
          if (onWorkspaceChange) {
            onWorkspaceChange();
          }
          refreshWorkspaceData();
        } else {
          alert(data.error || 'Failed to create workspace');
        }
      })
      .catch(err => {
        alert('Failed to create workspace: ' + err.message);
      });
  };

  const handleBuild = () => {
    setIsBuilding(true);
    fetch('/api/workspace/build', { method: 'POST' })
      .then(() => {
        setTimeout(() => setIsBuilding(false), 3000); // UI mock finish since build is detached
      })
      .catch(() => setIsBuilding(false));
  };

  return (
    <aside className="sidebar glass-panel">
      <div className="sidebar-header">
        {isCreatingWorkspace ? (
          <div className="workspace-editor-form">
            <input
              type="text"
              className="workspace-input font-mono"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleWorkspaceCreate();
                if (e.key === 'Escape') setIsCreatingWorkspace(false);
              }}
              placeholder="New workspace folder..."
              autoFocus
            />
            <div className="workspace-editor-actions">
              <button className="workspace-save-btn" onClick={handleWorkspaceCreate}>Create</button>
              <button className="workspace-cancel-btn" onClick={() => setIsCreatingWorkspace(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="workspace-header-container">
            <div className="workspace-dropdown-wrapper" title="Select workspace">
              <Folder size={18} className="icon" />
              <select
                className="workspace-select"
                value={workspaceName}
                onChange={(e) => handleWorkspaceSelect(e.target.value)}
              >
                {workspaces.map(w => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>
            <button className="workspace-add-btn" onClick={() => setIsCreatingWorkspace(true)} title="Create new workspace">
              <Plus size={16} />
            </button>
          </div>
        )}
      </div>
      
      <div className="sidebar-content">
        <div className="section">
          <h3 className="section-title">Agents</h3>
          <ul className="item-list">
            <li className={`item ${activeSession === null ? 'active' : ''}`} onClick={() => onSelectSession(null)}>
              <MessageSquare size={16} />
              <span>New Thread</span>
            </li>
            <li className="item" onClick={handleBuild}>
              {isBuilding ? <Loader2 size={16} className="spin" /> : <Terminal size={16} />}
              <span>{isBuilding ? 'Building...' : 'Background Build'}</span>
            </li>
          </ul>
        </div>
        
        <div className="section">
          <h3 className="section-title">Historical Sessions</h3>
          <ul className="item-list">
            {sessions.map((s) => (
              <li
                key={s.uuid}
                className={`item ${activeSession === s.uuid ? 'active' : ''}`}
                onClick={() => onSelectSession(s.uuid)}
                title={s.uuid}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', flex: 1 }}>
                  <MessageSquare size={16} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title || 'Session ' + s.uuid.substring(0, 6)}
                  </span>
                </div>
                {s.isRunning && (
                  <Loader2 size={12} className="spin" style={{ color: '#3b82f6', flexShrink: 0, marginLeft: '6px' }} />
                )}
              </li>
            ))}
            {sessions.length === 0 && (
              <li className="item" style={{ opacity: 0.45, pointerEvents: 'none' }}>
                <span>No past sessions yet</span>
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Usage Meter and Quota Display in the Bottom-Left */}
      <div className="sidebar-usage-region">
        <h3 className="usage-title">Quota Usage</h3>

        {/* 5-Hour Rolling Window */}
        <div className="quota-meter-label-row">
          <span className="quota-meter-label">5-Hour Limit</span>
          <span className={`quota-meter-pct ${(quotaInfo?.fiveHourRemaining ?? 100) <= 20 ? 'quota-low' : ''}`}>
            {(quotaInfo?.fiveHourRemaining ?? 100)}% remaining
          </span>
        </div>
        <div className="usage-progress-container">
          <div
            className="usage-progress-bar"
            style={{
              width: `${quotaInfo?.fiveHourRemaining ?? 100}%`,
              background: (quotaInfo?.fiveHourRemaining ?? 100) > 40
                ? 'linear-gradient(90deg, #3b82f6 0%, #6366f1 100%)'
                : (quotaInfo?.fiveHourRemaining ?? 100) > 10
                  ? 'linear-gradient(90deg, #f59e0b 0%, #f97316 100%)'
                  : 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
            }}
          />
        </div>
        {quotaInfo?.primaryResetSeconds && (quotaInfo?.fiveHourRemaining ?? 100) < 100 && (
          <span className="usage-text-muted" style={{ display: 'block', marginBottom: '0.5rem' }}>
            Resets in {formatResetTime(quotaInfo.primaryResetSeconds)}
          </span>
        )}

        {/* Weekly Quota */}
        <div className="quota-meter-label-row" style={{ marginTop: quotaInfo?.primaryResetSeconds ? '0.1rem' : '0.5rem' }}>
          <span className="quota-meter-label">Weekly Quota</span>
          <span className={`quota-meter-pct ${(quotaInfo?.weeklyRemaining ?? 100) <= 20 ? 'quota-low' : ''}`}>
            {(quotaInfo?.weeklyRemaining ?? 100)}% remaining
          </span>
        </div>
        <div className="usage-progress-container">
          <div
            className="usage-progress-bar"
            style={{
              width: `${quotaInfo?.weeklyRemaining ?? 100}%`,
              background: (quotaInfo?.weeklyRemaining ?? 100) > 40
                ? 'linear-gradient(90deg, #3b82f6 0%, #6366f1 100%)'
                : (quotaInfo?.weeklyRemaining ?? 100) > 10
                  ? 'linear-gradient(90deg, #f59e0b 0%, #f97316 100%)'
                  : 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
            }}
          />
        </div>
        {quotaInfo?.secondaryResetSeconds && (quotaInfo?.weeklyRemaining ?? 100) < 100 && (
          <span className="usage-text-muted" style={{ display: 'block', marginBottom: '0.5rem' }}>
            Resets in {formatResetTime(quotaInfo.secondaryResetSeconds)}
          </span>
        )}
      </div>

      {userInfo && (
        <div className="sidebar-user-profile">
          <div className="user-details">
            <span className="user-name" title={userInfo.name}>{userInfo.name || 'User'}</span>
            <span className="user-email" title={userInfo.email}>{userInfo.email || ''}</span>
          </div>
          <button className="logout-btn" onClick={onLogout}>
            Logout
          </button>
        </div>
      )}

      <div className="sidebar-footer">
        <button className="icon-btn" title="Search not implemented">
          <Search size={18} />
        </button>
        <button className="icon-btn" title="Settings not implemented">
          <Settings size={18} />
        </button>
      </div>
    </aside>
  );
}
