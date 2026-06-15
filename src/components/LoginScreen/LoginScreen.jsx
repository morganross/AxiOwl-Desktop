import React, { useEffect, useRef, useState } from 'react';
import { LogIn, Loader2, Command } from 'lucide-react';
import { desktopApi } from '../../lib/desktopApi';
import { appendRuntimeDiagnosticsHint } from '../../lib/runtimeMessaging';
import './LoginScreen.css';

function RuntimeStatusCard({ status, onViewDiagnostics }) {
  if (!status) {
    return null;
  }

  const firstRejectedAttempt = Array.isArray(status.attempts)
    ? status.attempts.find((attempt) => attempt?.status !== 'accepted')
    : null;

  return (
    <div className={`runtime-status-card ${status.available ? 'runtime-status-ok' : 'runtime-status-error'}`}>
      <div className="runtime-status-header">
        <span className="runtime-status-title">Codex Runtime</span>
        <span className="runtime-status-pill">{status.available ? 'Proven' : 'Unavailable'}</span>
      </div>
      <div className="runtime-status-body">
        <div className="runtime-status-row">
          <span className="runtime-status-label">Profile</span>
          <span className="runtime-status-value">{status.codexHome || 'Unknown'}</span>
        </div>
        {status.executable && (
          <div className="runtime-status-row">
            <span className="runtime-status-label">Executable</span>
            <span className="runtime-status-value">{status.executable}</span>
          </div>
        )}
        {status.source && (
          <div className="runtime-status-row">
            <span className="runtime-status-label">Source</span>
            <span className="runtime-status-value">{status.source}</span>
          </div>
        )}
        {status.version && (
          <div className="runtime-status-row">
            <span className="runtime-status-label">Version</span>
            <span className="runtime-status-value">{status.version}</span>
          </div>
        )}
        {!status.available && (status.error || firstRejectedAttempt) && (
          <div className="runtime-status-detail">
            {status.error || firstRejectedAttempt?.detail}
          </div>
        )}
        <button className="runtime-status-link" onClick={onViewDiagnostics} type="button">
          View discovery diagnostics
        </button>
      </div>
    </div>
  );
}

export default function LoginScreen({ onLoginSuccess, initialError, codexRuntimeStatus, onViewRuntimeDiagnostics }) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const loginPollRef = useRef(null);

  useEffect(() => {
    return () => {
      if (loginPollRef.current) {
        clearInterval(loginPollRef.current);
      }
    };
  }, []);

  const handleLogin = async () => {
    if (loginPollRef.current) {
      clearInterval(loginPollRef.current);
      loginPollRef.current = null;
    }
    setIsLoggingIn(true);
    setError(null);
    try {
      const data = await desktopApi.triggerLogin();
      
      if (data.deviceCode) {
        setDeviceInfo({ code: data.deviceCode, url: data.url });
        if (loginPollRef.current) {
          clearInterval(loginPollRef.current);
        }
        loginPollRef.current = setInterval(async () => {
          try {
            const statusData = await desktopApi.getAuthStatus();
            if (statusData.authenticated) {
              clearInterval(loginPollRef.current);
              loginPollRef.current = null;
              setIsLoggingIn(false);
              onLoginSuccess();
            }
          } catch (pollError) {
            clearInterval(loginPollRef.current);
            loginPollRef.current = null;
            setIsLoggingIn(false);
            setError(appendRuntimeDiagnosticsHint(
              pollError.message || 'Authentication status polling failed.',
              codexRuntimeStatus,
            ));
          }
        }, 2000);
      } else if (data.success) {
        setIsLoggingIn(false);
        onLoginSuccess();
      } else {
        setError(appendRuntimeDiagnosticsHint(
          'Authentication failed. Please try again.',
          codexRuntimeStatus,
        ));
        setIsLoggingIn(false);
      }
    } catch (err) {
      setError(appendRuntimeDiagnosticsHint(
        err.message || 'Authentication error. Could not start login.',
        codexRuntimeStatus,
      ));
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card glass-panel">
        <div className="login-header">
          <div className="logo-container">
            <Command size={48} className="logo-icon" />
          </div>
          <h1>Welcome to AxiOwl</h1>
          <p>Sign in with Codex device authentication to use the desktop app.</p>
        </div>
        
        {(error || initialError) && <div className="login-error">{error || initialError}</div>}
        <RuntimeStatusCard status={codexRuntimeStatus} onViewDiagnostics={onViewRuntimeDiagnostics} />

        {deviceInfo ? (
          <div className="device-code-container">
            <h3>Complete sign-in in your browser</h3>
            <p>Go to <a href={deviceInfo.url} target="_blank" rel="noreferrer" style={{color: '#60a5fa'}}>{deviceInfo.url}</a></p>
            <p>and enter the code:</p>
            <div className="device-code-box" style={{background: '#1a1a20', padding: '16px', borderRadius: '8px', fontSize: '24px', letterSpacing: '2px', fontWeight: 'bold', margin: '16px 0'}}>
              {deviceInfo.code}
            </div>
            <div className="login-actions" style={{marginTop: '24px'}}>
              <button className="login-btn" disabled>
                <Loader2 size={18} className="spin" /> Waiting for authentication...
              </button>
            </div>
          </div>
        ) : (
          <div className="login-actions">
            <button 
              className="login-btn" 
              onClick={handleLogin} 
              disabled={isLoggingIn}
            >
              {isLoggingIn ? (
                <><Loader2 size={18} className="spin" /> Spawning codex login...</>
              ) : (
                <><LogIn size={18} /> Sign In</>
              )}
            </button>
          </div>
        )}
        
        <div className="login-footer">
          Uses Codex device authentication
        </div>
      </div>
    </div>
  );
}
