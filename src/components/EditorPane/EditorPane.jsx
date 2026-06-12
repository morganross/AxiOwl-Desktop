import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Save, FileCode, CheckCircle, AlertCircle } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import './EditorPane.css';

function getLanguageExtension(filePath) {
  if (!filePath) return [];
  const ext = filePath.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'html':
      return [html()];
    case 'css':
      return [css()];
    case 'json':
      return [json()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'py':
      return [python()];
    default:
      return [];
  }
}

function getLanguage(filePath) {
  if (!filePath) return 'text';
  const ext = filePath.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', json: 'json', md: 'markdown', css: 'css', html: 'html',
    sh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'toml', rs: 'rust',
    go: 'go', c: 'c', cpp: 'cpp', java: 'java', rb: 'ruby',
  };
  return map[ext] || 'text';
}

function TabBar({ tabs, activeTabPath, onTabSelect, onTabClose }) {
  return (
    <div className="editor-tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          className={`editor-tab ${tab.path === activeTabPath ? 'active' : ''} ${tab.isDirty ? 'dirty' : ''}`}
          onClick={() => onTabSelect(tab.path)}
          title={tab.path}
        >
          <FileCode size={12} className="tab-file-icon" />
          <span className="tab-name">{tab.name}</span>
          {tab.isDirty && <span className="dirty-dot" title="Unsaved changes" />}
          <button
            className="tab-close-btn"
            onClick={(e) => { e.stopPropagation(); onTabClose(tab.path); }}
            title="Close tab"
          >
            <X size={11} />
          </button>
        </div>
      ))}
      {tabs.length === 0 && (
        <div className="editor-tab-empty-hint">No files open</div>
      )}
    </div>
  );
}

export default function EditorPane({ openFiles, activeFilePath, onTabSelect, onTabClose, onFileSave }) {
  // Local edit state per tab: path → content string
  const [editContents, setEditContents] = useState({});
  const [saveState, setSaveState] = useState({}); // path → 'saved' | 'error' | null

  const lastContentsRef = useRef({});

  // Seed or update edit content when tab files change or load
  useEffect(() => {
    openFiles.forEach(tab => {
      const prevContent = lastContentsRef.current[tab.path];
      const localContent = editContents[tab.path];
      
      if (localContent === undefined || tab.content !== prevContent) {
        setEditContents(prev => ({ ...prev, [tab.path]: tab.content }));
        lastContentsRef.current[tab.path] = tab.content;
      }
    });
    
    // Clean up closed files from tracking refs/state
    const openPaths = new Set(openFiles.map(f => f.path));
    Object.keys(lastContentsRef.current).forEach(p => {
      if (!openPaths.has(p)) {
        delete lastContentsRef.current[p];
      }
    });
  }, [openFiles]);

  const activeTab = openFiles.find(t => t.path === activeFilePath);
  const currentContent = activeFilePath !== undefined ? (editContents[activeFilePath] ?? activeTab?.content ?? '') : '';
  const isDirty = activeTab && editContents[activeFilePath] !== undefined && editContents[activeFilePath] !== activeTab.content;

  const handleEditorChange = useCallback((value) => {
    if (!activeFilePath) return;
    setEditContents(prev => ({ ...prev, [activeFilePath]: value }));
  }, [activeFilePath]);

  const handleSave = useCallback(async () => {
    if (!activeFilePath) return;
    const content = editContents[activeFilePath] ?? activeTab?.content ?? '';
    try {
      await onFileSave(activeFilePath, content);
      setSaveState(prev => ({ ...prev, [activeFilePath]: 'saved' }));
      setTimeout(() => setSaveState(prev => ({ ...prev, [activeFilePath]: null })), 2000);
    } catch {
      setSaveState(prev => ({ ...prev, [activeFilePath]: 'error' }));
      setTimeout(() => setSaveState(prev => ({ ...prev, [activeFilePath]: null })), 3000);
    }
  }, [activeFilePath, editContents, activeTab, onFileSave]);

  // Ctrl+S / Cmd+S to save, or trigger via custom event
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    const customSaveHandler = () => {
      handleSave();
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('trigger-file-save', customSaveHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('trigger-file-save', customSaveHandler);
    };
  }, [handleSave]);

  // Mark tab as open/dirty based on local edits
  const tabsWithDirty = openFiles.map(t => ({
    ...t,
    isDirty: editContents[t.path] !== undefined && editContents[t.path] !== t.content,
  }));

  const sv = activeFilePath ? saveState[activeFilePath] : null;

  return (
    <div className="editor-pane">
      <TabBar
        tabs={tabsWithDirty}
        activeTabPath={activeFilePath}
        onTabSelect={onTabSelect}
        onTabClose={onTabClose}
      />

      {activeTab ? (
        <div className="editor-body">
          <div className="editor-toolbar">
            <span className="editor-filepath" title={activeTab.path}>
              {activeTab.path}
            </span>
            <div className="editor-toolbar-actions">
              {sv === 'saved' && (
                <span className="save-status saved"><CheckCircle size={13} /> Saved</span>
              )}
              {sv === 'error' && (
                <span className="save-status error"><AlertCircle size={13} /> Save failed</span>
              )}
              <span className="editor-lang-badge">{getLanguage(activeTab.path)}</span>
              <button
                className={`editor-save-btn ${isDirty ? 'dirty' : ''}`}
                onClick={handleSave}
                title="Save file (Ctrl+S)"
              >
                <Save size={14} />
                {isDirty ? 'Save*' : 'Save'}
              </button>
            </div>
          </div>

          <div className="editor-content-area">
            <CodeMirror
              value={currentContent}
              className="rich-editor"
              theme="dark"
              height="100%"
              extensions={getLanguageExtension(activeTab.path)}
              onChange={handleEditorChange}
            />
          </div>
        </div>
      ) : (
        <div className="editor-empty-state">
          <FileCode size={48} className="editor-empty-icon" />
          <p className="editor-empty-title">No file open</p>
          <p className="editor-empty-hint">
            Click a file in the sidebar, or files modified by Qexow will open automatically.
          </p>
        </div>
      )}
    </div>
  );
}
