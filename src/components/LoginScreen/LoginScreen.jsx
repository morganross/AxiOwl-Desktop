import React, { useState } from 'react';
import { LogIn, Loader2, Command } from 'lucide-react';
import './LoginScreen.css';

export default function LoginScreen({ onLoginSuccess }) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST' });
      const data = await res.json();
      
      if (data.deviceCode) {
        setDeviceInfo({ code: data.deviceCode, url: data.url, isFallback: data.isFallback });
        // Poll for success
        const interval = setInterval(async () => {
          const statusRes = await fetch('/api/auth/status');
          const statusData = await statusRes.json();
          if (statusData.authenticated) {
            clearInterval(interval);
            onLoginSuccess();
          }
        }, 2000);
      } else if (data.success) {
        onLoginSuccess();
      } else {
        setError('Authentication failed. Please try again.');
        setIsLoggingIn(false);
      }
    } catch (err) {
      setError('Network error. Could not reach Codex server.');
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
          <h1>Welcome to Codex</h1>
          <p>Login with OAuth to start a secure conversation.</p>
        </div>
        
        {error && <div className="login-error">{error}</div>}

        {deviceInfo ? (
          <div className="device-code-container">
            <h3>Please authenticate in your browser</h3>
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
                <><LogIn size={18} /> Login with OAuth</>
              )}
            </button>
          </div>
        )}
        
        <div className="login-footer">
          Powered by Codex Desktop Engine
        </div>
      </div>
    </div>
  );
}
