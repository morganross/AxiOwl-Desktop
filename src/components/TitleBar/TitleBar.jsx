import React, { useState, useEffect } from 'react';
import { Terminal, Info, Layout, Save } from 'lucide-react';
import './TitleBar.css';

export default function TitleBar({
  showSidebar,
  showReviewPane,
  onToggleSidebar,
  onToggleReviewPane,
  onSaveFile,
  activeFilePath,
  onNewWorkspace,
  onShowAbout
}) {
  const [activeMenu, setActiveMenu] = useState(null); // 'file' | 'view' | 'about' | null

  // Close menus when clicking anywhere else
  useEffect(() => {
    const closeMenus = () => setActiveMenu(null);
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  const handleMenuClick = (e, menu) => {
    e.stopPropagation();
    setActiveMenu(prev => prev === menu ? null : menu);
  };

  return (
    <header className="title-bar">
      <div className="title-bar-left">
        <div className="title-bar-logo">
          <Terminal size={14} className="logo-icon" />
          <span className="logo-text">Qexow</span>
        </div>

        <nav className="menu-bar">
          {/* File Menu */}
          <div className="menu-item-container">
            <button
              className={`menu-btn ${activeMenu === 'file' ? 'active' : ''}`}
              onClick={(e) => handleMenuClick(e, 'file')}
            >
              File
            </button>
            {activeMenu === 'file' && (
              <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
                <button className="dropdown-btn" onClick={() => { onNewWorkspace(); setActiveMenu(null); }}>
                  <Layout size={13} className="menu-icon" />
                  <span>New Workspace</span>
                </button>
                <button
                  className="dropdown-btn"
                  disabled={!activeFilePath}
                  onClick={() => { onSaveFile(); setActiveMenu(null); }}
                >
                  <Save size={13} className="menu-icon" />
                  <span>Save File</span>
                  <span className="shortcut-hint">Ctrl+S</span>
                </button>
              </div>
            )}
          </div>

          {/* View Menu */}
          <div className="menu-item-container">
            <button
              className={`menu-btn ${activeMenu === 'view' ? 'active' : ''}`}
              onClick={(e) => handleMenuClick(e, 'view')}
            >
              View
            </button>
            {activeMenu === 'view' && (
              <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
                <button className="dropdown-btn" onClick={() => { onToggleSidebar(); setActiveMenu(null); }}>
                  <Layout size={13} className="menu-icon" />
                  <span>{showSidebar ? 'Hide Sidebar' : 'Show Sidebar'}</span>
                </button>
                <button className="dropdown-btn" onClick={() => { onToggleReviewPane(); setActiveMenu(null); }}>
                  <Layout size={13} className="menu-icon" />
                  <span>{showReviewPane ? 'Hide Editor' : 'Show Editor'}</span>
                </button>
              </div>
            )}
          </div>

          {/* About Menu */}
          <div className="menu-item-container">
            <button
              className={`menu-btn ${activeMenu === 'about' ? 'active' : ''}`}
              onClick={(e) => handleMenuClick(e, 'about')}
            >
              About
            </button>
            {activeMenu === 'about' && (
              <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
                <button
                  className="dropdown-btn"
                  onClick={() => { onShowAbout(); setActiveMenu(null); }}
                >
                  <Info size={13} className="menu-icon" />
                  <span>About Qexow</span>
                </button>
              </div>
            )}
          </div>
        </nav>
      </div>

      <div className="title-bar-center">
        {activeFilePath && (
          <span className="title-bar-file-path" title={activeFilePath}>
            {activeFilePath.split(/[\\/]/).pop()}
          </span>
        )}
      </div>

      <div className="title-bar-right">
        <div className="web-badge" title="Running in Web Mode">Web Mode</div>
      </div>
    </header>
  );
}
