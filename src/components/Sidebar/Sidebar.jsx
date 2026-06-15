import React, { useEffect, useState } from 'react';
import { Folder, MessageSquare, Loader2, Plus } from 'lucide-react';
import { desktopApi } from '../../lib/desktopApi';
import './Sidebar.css';

function actionError(prefix, error, fallback) {
  const detail = error?.message || fallback;
  return `${prefix} ${detail}`;
}

function formatResetTime(seconds) {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function QuotaBucket({ label, planType, fiveHourRemaining, weeklyRemaining, primaryResetSeconds, secondaryResetSeconds, showDivider = false }) {
  return (
    <div style={showDivider ? { paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.08)' } : undefined}>
      {label && (
        <div className="usage-text-muted" style={{ display: 'block', marginBottom: '0.35rem' }}>
          {planType ? `${label} (${planType})` : label}
        </div>
      )}

      {fiveHourRemaining != null && (
        <>
          <div className="quota-meter-label-row">
            <span className="quota-meter-label">5-Hour Limit</span>
            <span className={`quota-meter-pct ${fiveHourRemaining <= 20 ? 'quota-low' : ''}`}>
              {fiveHourRemaining}% remaining
            </span>
          </div>
          <div className="usage-progress-container">
            <div
              className="usage-progress-bar"
              style={{
                width: `${fiveHourRemaining}%`,
                background: fiveHourRemaining > 40
                  ? 'linear-gradient(90deg, #3b82f6 0%, #6366f1 100%)'
                  : fiveHourRemaining > 10
                    ? 'linear-gradient(90deg, #f59e0b 0%, #f97316 100%)'
                    : 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
              }}
            />
          </div>
          {primaryResetSeconds && fiveHourRemaining < 100 && (
            <span className="usage-text-muted" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Resets in {formatResetTime(primaryResetSeconds)}
            </span>
          )}
        </>
      )}

      {weeklyRemaining != null && (
        <>
          <div className="quota-meter-label-row" style={{ marginTop: primaryResetSeconds ? '0.1rem' : '0.5rem' }}>
            <span className="quota-meter-label">Weekly Quota</span>
            <span className={`quota-meter-pct ${weeklyRemaining <= 20 ? 'quota-low' : ''}`}>
              {weeklyRemaining}% remaining
            </span>
          </div>
          <div className="usage-progress-container">
            <div
              className="usage-progress-bar"
              style={{
                width: `${weeklyRemaining}%`,
                background: weeklyRemaining > 40
                  ? 'linear-gradient(90deg, #3b82f6 0%, #6366f1 100%)'
                  : weeklyRemaining > 10
                    ? 'linear-gradient(90deg, #f59e0b 0%, #f97316 100%)'
                    : 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
              }}
            />
          </div>
          {secondaryResetSeconds && weeklyRemaining < 100 && (
            <span className="usage-text-muted" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Resets in {formatResetTime(secondaryResetSeconds)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function RuntimeStatusSummary({ status, onViewDiagnostics }) {
  if (!status) {
    return null;
  }

  return (
    <div className={`runtime-summary-card ${status.available ? 'runtime-summary-ok' : 'runtime-summary-error'}`}>
      <div className="runtime-summary-header">
        <span className="usage-title" style={{ marginBottom: 0 }}>Codex Runtime</span>
        <span className="runtime-summary-pill">{status.available ? 'Ready' : 'Broken'}</span>
      </div>
      {status.executable && (
        <span className="usage-text-muted runtime-summary-line">
          {status.executable}
        </span>
      )}
      {status.source && (
        <span className="usage-text-muted runtime-summary-line">
          Source: {status.source}
        </span>
      )}
      {!status.available && status.error && (
        <span className="usage-text-muted quota-unavailable runtime-summary-line">
          {status.error}
        </span>
      )}
      <button className="runtime-summary-link" onClick={onViewDiagnostics} type="button">
        View discovery diagnostics
      </button>
    </div>
  );
}

export default function Sidebar({ sessions, activeSession, onSelectSession, userInfo, onLogout, quotaInfo, codexRuntimeStatus, onViewRuntimeDiagnostics, sessionsError, onWorkspaceChange, workspaceRefreshKey }) {
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const fiveHourRemaining = quotaInfo?.fiveHourRemaining;
  const weeklyRemaining = quotaInfo?.weeklyRemaining;
  const additionalLimits = Array.isArray(quotaInfo?.additionalLimits) ? quotaInfo.additionalLimits : [];
  const hasQuotaData =
    fiveHourRemaining != null
    || weeklyRemaining != null
    || additionalLimits.some((limit) => limit?.fiveHourRemaining != null || limit?.weeklyRemaining != null);

  const refreshWorkspaceData = () => {
    desktopApi.getWorkspaces()
      .then(data => {
        setWorkspaceName(data.active);
        setWorkspaces(data.workspaces);
        setWorkspaceStatus('');
      })
      .catch(err => {
        console.error('Failed to load workspace list:', err);
        setWorkspaceStatus(actionError(
          'Could not load sibling workspaces.',
          err,
          'Workspace discovery failed.',
        ));
      });
  };

  useEffect(() => {
    refreshWorkspaceData();
  }, [workspaceRefreshKey]);

  useEffect(() => {
    const handleOpenWorkspaceCreate = () => {
      setWorkspaceStatus('');
      setIsCreatingWorkspace(true);
    };
    window.addEventListener('open-workspace-create', handleOpenWorkspaceCreate);
    return () => window.removeEventListener('open-workspace-create', handleOpenWorkspaceCreate);
  }, []);

  const handleWorkspaceSelect = (name) => {
    setWorkspaceStatus('');
    desktopApi.selectWorkspace(name)
      .then(data => {
        setWorkspaceName(data.name);
        if (onWorkspaceChange) {
          onWorkspaceChange();
        }
      })
      .catch(err => {
        setWorkspaceStatus(actionError(
          `Could not switch to workspace "${name}".`,
          err,
          'Workspace selection failed.',
        ));
      });
  };

  const handleWorkspaceCreate = () => {
    const name = newWorkspaceName.trim();
    if (!name) {
      setWorkspaceStatus('Workspace name cannot be empty.');
      return;
    }

    setWorkspaceStatus('');
    desktopApi.createWorkspace(name)
      .then(data => {
        setWorkspaceName(data.name);
        setIsCreatingWorkspace(false);
        setNewWorkspaceName('');
        if (onWorkspaceChange) {
          onWorkspaceChange();
        }
        refreshWorkspaceData();
      })
      .catch(err => {
        setWorkspaceStatus(actionError(
          `Could not create workspace "${name}".`,
          err,
          'Workspace creation failed.',
        ));
      });
  };

  const displayName =
    userInfo?.name
    || userInfo?.email
    || (userInfo?.method === 'api_key' ? 'OpenAI API Key' : 'ChatGPT Account');
  const secondaryIdentity =
    userInfo?.name && userInfo?.email
      ? userInfo.email
      : userInfo?.method === 'api_key'
        ? 'Local API key auth'
        : '';

  return (
    <aside className="sidebar glass-panel">
      <div className="sidebar-header">
        {isCreatingWorkspace ? (
          <div className="workspace-editor-form">
            <label className="workspace-input-label" htmlFor="new-workspace-name">
              Workspace name
            </label>
            <input
              id="new-workspace-name"
              type="text"
              className="workspace-input font-mono"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleWorkspaceCreate();
                if (e.key === 'Escape') {
                  setWorkspaceStatus('');
                  setIsCreatingWorkspace(false);
                }
              }}
              autoFocus
              aria-label="Workspace name"
            />
            <div className="workspace-editor-actions">
              <button className="workspace-save-btn" onClick={handleWorkspaceCreate}>Create</button>
              <button
                className="workspace-cancel-btn"
                onClick={() => {
                  setWorkspaceStatus('');
                  setIsCreatingWorkspace(false);
                }}
              >
                Cancel
              </button>
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
                {workspaceName === '' && <option value="">No workspace available</option>}
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
        {workspaceStatus && (
          <div className="sidebar-status-message error-text">{workspaceStatus}</div>
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
          </ul>
        </div>
        
        <div className="section">
          <h3 className="section-title">Historical Sessions</h3>
          {sessionsError && (
            <div className="sidebar-status-message error-text">{sessionsError}</div>
          )}
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
                    {s.title || s.uuid}
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
        <h3 className="usage-title">Quota Status</h3>

        {!hasQuotaData && quotaInfo?.error && (
          <span className="usage-text-muted quota-unavailable">
            {quotaInfo.error}
          </span>
        )}

        {(fiveHourRemaining != null || weeklyRemaining != null) && (
          <QuotaBucket
            label={quotaInfo?.limitLabel}
            planType={quotaInfo?.planType}
            fiveHourRemaining={fiveHourRemaining}
            weeklyRemaining={weeklyRemaining}
            primaryResetSeconds={quotaInfo?.primaryResetSeconds}
            secondaryResetSeconds={quotaInfo?.secondaryResetSeconds}
          />
        )}

        {additionalLimits.map((limit) => (
          <QuotaBucket
            key={limit.limitId || limit.label}
            label={limit.label}
            planType={limit.planType}
            fiveHourRemaining={limit.fiveHourRemaining}
            weeklyRemaining={limit.weeklyRemaining}
            primaryResetSeconds={limit.primaryResetSeconds}
            secondaryResetSeconds={limit.secondaryResetSeconds}
            showDivider={fiveHourRemaining != null || weeklyRemaining != null}
          />
        ))}
      </div>

      <div className="sidebar-usage-region">
        <RuntimeStatusSummary status={codexRuntimeStatus} onViewDiagnostics={onViewRuntimeDiagnostics} />
      </div>

      {userInfo && (
        <div className="sidebar-user-profile">
          <div className="user-details">
            <span className="user-name" title={displayName}>{displayName}</span>
            <span className="user-email" title={secondaryIdentity}>{secondaryIdentity}</span>
          </div>
          <button className="logout-btn" onClick={onLogout}>
            Logout
          </button>
        </div>
      )}
    </aside>
  );
}
