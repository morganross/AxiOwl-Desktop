import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Terminal, Copy, Check, FileCode, GitBranch, FolderOpen, ArrowDown } from 'lucide-react';
import { AssistantRuntimeProvider, useLocalRuntime, ThreadPrimitive, useMessage, MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { MarkdownTextPrimitive, useIsMarkdownCodeBlock } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import './ThreadView.css';

// AsyncQueue to bridge EventSource callback streams to async generators (async function* run)
class AsyncQueue {
  constructor() {
    this.queue = [];
    this.resolvers = [];
  }
  push(item) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve(item);
    } else {
      this.queue.push(item);
    }
  }
  async pop() {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }
    return new Promise(resolve => {
      this.resolvers.push(resolve);
    });
  }
}

// Custom hook to handle copy functionality
const useCopyToClipboard = (copiedDuration = 3000) => {
  const [isCopied, setIsCopied] = useState(false);
  const copyToClipboard = (value) => {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(
      () => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), copiedDuration);
      },
      () => {}
    );
  };
  return { isCopied, copyToClipboard };
};

// Beautiful header for Markdown code blocks with a Copy button
const CodeHeader = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  return (
    <div className="code-header">
      <span className="code-lang">{language || 'code'}</span>
      <button className="code-copy-btn" onClick={() => copyToClipboard(code)} title="Copy code">
        {isCopied ? <Check size={13} className="success-icon" /> : <Copy size={13} />}
        <span>{isCopied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
};

// Rich Markdown renderer styled after assistant-ui aesthetics
const CustomMarkdown = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="custom-markdown"
      components={{
        h1: (props) => <h1 className="md-h1" {...props} />,
        h2: (props) => <h2 className="md-h2" {...props} />,
        h3: (props) => <h3 className="md-h3" {...props} />,
        h4: (props) => <h4 className="md-h4" {...props} />,
        p: (props) => <p className="md-p" {...props} />,
        blockquote: (props) => <blockquote className="md-blockquote" {...props} />,
        ul: (props) => <ul className="md-ul" {...props} />,
        ol: (props) => <ol className="md-ol" {...props} />,
        table: (props) => <table className="md-table" {...props} />,
        th: (props) => <th className="md-th" {...props} />,
        td: (props) => <td className="md-td" {...props} />,
        pre: (props) => <pre className="md-pre" {...props} />,
        code: function Code({ className, ...props }) {
          const isCodeBlock = useIsMarkdownCodeBlock();
          return (
            <code
              className={isCodeBlock ? 'md-block-code font-mono' : 'md-inline-code font-mono'}
              {...props}
            />
          );
        },
        CodeHeader: CodeHeader,
      }}
      defer
    />
  );
};

// User Message: Aligned right, rendered as a sleek speech bubble
const UserMessage = () => {
  return (
    <MessagePrimitive.Root className="user-message-container">
      <div className="user-message-bubble">
        <MessagePrimitive.Content components={{ Text: CustomMarkdown }} />
      </div>
    </MessagePrimitive.Root>
  );
};

// Assistant Message: Aligned left, direct canvas text, with custom glowing Codex avatar
const AssistantMessage = () => {
  return (
    <MessagePrimitive.Root className="assistant-message-container">
      <div className="assistant-avatar-wrapper">
        <div className="assistant-avatar-glow">
          <Terminal size={14} className="assistant-avatar-icon" />
        </div>
      </div>
      <div className="assistant-message-content">
        <MessagePrimitive.Content components={{ Text: CustomMarkdown }} />
      </div>
    </MessagePrimitive.Root>
  );
};

// Interactive suggestions screen for the empty chat state
const WelcomeScreen = ({ onSelectPrompt }) => {
  const suggestions = [
    {
      title: "Create hello_world.md",
      desc: "Generates a basic hello world markdown file in the workspace",
      prompt: "create a new markdown file named hello_world.md with contents '# Hello World' inside the workspace",
      icon: <FileCode size={20} className="suggestion-icon code" />
    },
    {
      title: "Verify system status",
      desc: "Runs a diagnostic test of the local backend process",
      prompt: "run a diagnostic status check",
      icon: <Terminal size={20} className="suggestion-icon status" />
    },
    {
      title: "Show workspace files",
      desc: "Lists and summarizes all active files in the workspace",
      prompt: "list the files currently in the workspace",
      icon: <FolderOpen size={20} className="suggestion-icon files" />
    },
    {
      title: "Check Git status",
      desc: "Checks for modified, unstaged, or untracked changes",
      prompt: "check git status for the repository",
      icon: <GitBranch size={20} className="suggestion-icon git" />
    }
  ];

  return (
    <div className="welcome-container">
      <div className="welcome-header animate-fade-in">
        <div className="welcome-logo-glow">
          <Terminal size={32} className="welcome-logo-icon" />
        </div>
        <h1 className="welcome-title">How can I help you today?</h1>
        <p className="welcome-subtitle">Ask Qexow to write code, modify files, or execute CLI tasks.</p>
      </div>
      <div className="suggestions-grid animate-fade-in-delayed">
        {suggestions.map((s, idx) => (
          <button 
            key={idx} 
            className="suggestion-card" 
            onClick={() => onSelectPrompt(s.prompt)}
          >
            <div className="suggestion-card-header">
              {s.icon}
              <span className="suggestion-card-title">{s.title}</span>
            </div>
            <p className="suggestion-card-desc">{s.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

// Scroll to bottom button
const ThreadScrollToBottom = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <button className="scroll-to-bottom-btn" title="Scroll to bottom">
        <ArrowDown size={16} />
      </button>
    </ThreadPrimitive.ScrollToBottom>
  );
};

// Content wrapper to switch between Empty state and messages list
const ThreadContent = ({ onSelectPrompt }) => {
  const messages = useAuiState(s => s.thread.messages);
  const isEmpty = messages.length === 0;

  if (isEmpty) {
    return <WelcomeScreen onSelectPrompt={onSelectPrompt} />;
  }

  return (
    <ThreadPrimitive.Viewport className="messages-container">
      <ThreadPrimitive.Messages
        components={{
          UserMessage: UserMessage,
          AssistantMessage: AssistantMessage,
        }}
      />
      <ThreadPrimitive.ViewportFooter>
        <ThreadScrollToBottom />
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Viewport>
  );
};

export default function ThreadView({ activeSession, sessions, onFileOpen, onTerminalOutput, activeFileContent, activeFilePath, lastTerminalOutputRef, onDiffReceived, onSessionCreated, onSessionFinished, onModelInfoChanged, onTokenUsageUpdated }) {
  const [isTyping, setIsTyping] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('New Thread');
  const [inputValue, setInputValue] = useState('');
  
  const textareaRef = useRef(null);

  // Keep track of the active session we are streaming to avoid race conditions
  const streamedSessionUuidRef = useRef(null);
  // Keep track of the activeSession prop in a ref for callback access
  const activeSessionRef = useRef(activeSession);
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onSessionFinishedRef = useRef(onSessionFinished);
  const onDiffReceivedRef = useRef(onDiffReceived);
  const onFileOpenRef = useRef(onFileOpen);
  const onTerminalOutputRef = useRef(onTerminalOutput);
  const onTokenUsageUpdatedRef = useRef(onTokenUsageUpdated);
  const pendingNewSessionPromptRef = useRef('');

  // Keep refs in sync
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  useEffect(() => { onSessionCreatedRef.current = onSessionCreated; }, [onSessionCreated]);
  useEffect(() => { onSessionFinishedRef.current = onSessionFinished; }, [onSessionFinished]);
  useEffect(() => { onDiffReceivedRef.current = onDiffReceived; }, [onDiffReceived]);
  useEffect(() => { onFileOpenRef.current = onFileOpen; }, [onFileOpen]);
  useEffect(() => { onTerminalOutputRef.current = onTerminalOutput; }, [onTerminalOutput]);
  useEffect(() => { onTokenUsageUpdatedRef.current = onTokenUsageUpdated; }, [onTokenUsageUpdated]);

  const [models, setModels] = useState([
    { slug: "gpt-5.4-mini", display_name: "gpt-5.4-mini" },
    { slug: "gpt-5.5", display_name: "gpt-5.5" },
    { slug: "gpt-5.4", display_name: "gpt-5.4" },
    { slug: "gpt-5.3-codex-spark", display_name: "gpt-5.3-codex-spark" },
    { slug: "gpt-5.3-codex", display_name: "gpt-5.3-codex" },
    { slug: "gpt-5.2", display_name: "gpt-5.2" }
  ]);

  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem(`qexow_model_${activeSession || 'new'}`);
    return saved || 'gpt-5.4-mini';
  });

  const [selectedReasoning, setSelectedReasoning] = useState(() => {
    const saved = localStorage.getItem(`qexow_reasoning_${activeSession || 'new'}`);
    return saved || 'default';
  });

  const [selectedSpeed, setSelectedSpeed] = useState(() => {
    const saved = localStorage.getItem(`qexow_speed_${activeSession || 'new'}`);
    return saved || 'default';
  });

  // Fetch dynamic models on mount
  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setModels(data);
        }
      })
      .catch(err => console.error('Failed to fetch models:', err));
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(`qexow_model_${activeSession || 'new'}`);
    setSelectedModel(saved || 'gpt-5.4-mini');

    const savedReasoning = localStorage.getItem(`qexow_reasoning_${activeSession || 'new'}`);
    setSelectedReasoning(savedReasoning || 'default');

    const savedSpeed = localStorage.getItem(`qexow_speed_${activeSession || 'new'}`);
    setSelectedSpeed(savedSpeed || 'default');
  }, [activeSession]);

  useEffect(() => {
    const activeModelObj = models.find(m => m.slug === selectedModel);
    const context = activeModelObj ? activeModelObj.context_window : 272000;
    if (onModelInfoChanged) {
      onModelInfoChanged(selectedModel, context);
    }
  }, [selectedModel, models, onModelInfoChanged]);

  const runtime = useLocalRuntime({
    async *run({ messages }) {
      setIsTyping(true);
      const lastMessage = messages[messages.length - 1];
      const prompt = lastMessage.content[0]?.text || '';
      pendingNewSessionPromptRef.current = prompt;

      // ── Context injection: prepend active file + last terminal output ────
      let contextPrefix = '';
      if (activeFilePath && activeFileContent) {
        const maxLines = 500;
        const lines = activeFileContent.split('\n');
        const capped = lines.length > maxLines
          ? lines.slice(0, maxLines).join('\n') + `\n... [truncated, ${lines.length - maxLines} more lines]`
          : activeFileContent;
        contextPrefix += `[Active File: ${activeFilePath}]\n\`\`\`\n${capped}\n\`\`\`\n\n`;
      }
      const lastTerminal = lastTerminalOutputRef?.current;
      if (lastTerminal && lastTerminal.trim()) {
        const termLines = lastTerminal.split('\n').slice(-50).join('\n');
        contextPrefix += `[Recent Terminal Output]\n\`\`\`\n${termLines}\n\`\`\`\n\n`;
      }
      const enrichedPrompt = contextPrefix ? `${contextPrefix}${prompt}` : prompt;

      const currentUuid = activeSessionRef.current || streamedSessionUuidRef.current || 'new';
      const currentModel =
        localStorage.getItem(`qexow_model_${currentUuid}`) || 'gpt-5.4-mini';
      const currentReasoning =
        localStorage.getItem(`qexow_reasoning_${currentUuid}`) || 'default';
      const currentSpeed =
        localStorage.getItem(`qexow_speed_${currentUuid}`) || 'default';

      const queue = new AsyncQueue();
      console.log('[ThreadView] Connecting EventSource with uuid:', currentUuid, 'model:', currentModel, 'reasoning:', currentReasoning, 'speed:', currentSpeed);
      const eventSource = new EventSource(
        `/api/exec?prompt=${encodeURIComponent(enrichedPrompt)}&sessionUuid=${encodeURIComponent(currentUuid)}&model=${encodeURIComponent(currentModel)}&reasoning=${encodeURIComponent(currentReasoning)}&speed=${encodeURIComponent(currentSpeed)}`
      );

      eventSource.onmessage = (e) => {
        queue.push(JSON.parse(e.data));
      };
      eventSource.onerror = (err) => {
        queue.push({ type: 'error', error: err });
      };

      let fullResponse = '';
      try {
        while (true) {
          const event = await queue.pop();
          console.log('[ThreadView] SSE event in generator:', event.type, event);

          if (event.type === 'thread.started') {
            const newUuid = event.thread_id;
            streamedSessionUuidRef.current = newUuid;

            const modelToSave = localStorage.getItem('qexow_model_new') || 'gpt-5.4-mini';
            localStorage.setItem(`qexow_model_${newUuid}`, modelToSave);

            const reasoningToSave = localStorage.getItem('qexow_reasoning_new') || 'default';
            localStorage.setItem(`qexow_reasoning_${newUuid}`, reasoningToSave);

            const speedToSave = localStorage.getItem('qexow_speed_new') || 'default';
            localStorage.setItem(`qexow_speed_${newUuid}`, speedToSave);

            if (!activeSessionRef.current && onSessionCreatedRef.current) {
              console.log('[ThreadView] Calling onSessionCreated for:', newUuid);
              onSessionCreatedRef.current(newUuid, pendingNewSessionPromptRef.current);
            }
          } else if (event.type === 'message') {
            fullResponse += event.content;
            yield { content: [{ type: 'text', text: fullResponse }] };
          } else if (event.type === 'content_chunk' && event.delta?.text) {
            fullResponse += event.delta.text;
            yield { content: [{ type: 'text', text: fullResponse }] };
          } else if (
            event.type === 'item.completed' &&
            event.item?.type === 'agent_message' &&
            event.item.text
          ) {
            if (!fullResponse.includes(event.item.text)) {
              fullResponse += event.item.text;
              yield { content: [{ type: 'text', text: fullResponse }] };
            }
          } else if (event.type === 'approval_request') {
            fullResponse += `\n\n> **⚠️ Action Required**: Codex wants to run \`${event.command}\`.\n\nType **Approve** to authorize this action.\n`;
            yield { content: [{ type: 'text', text: fullResponse }] };
          } else if (event.type === 'diff') {
            if (onDiffReceivedRef.current) onDiffReceivedRef.current(event);
            // Auto-open the modified file in the editor
            if (event.absolutePath && onFileOpenRef.current) {
              onFileOpenRef.current(event.absolutePath);
            }
            fullResponse += `\n\n> **📝 File Changed**: \`${event.file}\` — opened in editor.\n`;
          } else if (event.type === 'terminal_output') {
            const cmd = event.command ? `$ ${event.command}` : '';
            const out = event.output || '';
            const termText = [cmd, out].filter(Boolean).join('\n');
            // Accumulate terminal output for next context injection
            if (onTerminalOutputRef.current) onTerminalOutputRef.current(termText);
            if (lastTerminalOutputRef) lastTerminalOutputRef.current = termText;
            // Show inline as a collapsible terminal block
            if (cmd || out) {
              fullResponse += `\n\n<details><summary>🖥️ Terminal: <code>${event.command || 'shell'}</code></summary>\n\n\`\`\`\n${out}\n\`\`\`\n</details>\n`;
              yield { content: [{ type: 'text', text: fullResponse }] };
            }
          } else if (event.type === 'turn.completed' && event.usage) {
            const usage = event.usage;
            const totalUsed = (usage.input_tokens || 0) + (usage.output_tokens || 0);
            localStorage.setItem(`qexow_usage_${currentUuid}`, totalUsed);
            if (onTokenUsageUpdatedRef.current) {
              onTokenUsageUpdatedRef.current(totalUsed);
            }
          } else if (event.type === 'end') {
            eventSource.close();
            setIsTyping(false);
            if (onSessionFinishedRef.current) onSessionFinishedRef.current();
            break;
          } else if (event.type === 'error') {
            eventSource.close();
            setIsTyping(false);
            if (onSessionFinishedRef.current) onSessionFinishedRef.current();
            fullResponse += `\n\n> **Error**: Connection to codex stream lost.`;
            yield { content: [{ type: 'text', text: fullResponse }] };
            break;
          }
        }
      } finally {
        eventSource.close();
        setIsTyping(false);
      }
    }
  });

  // ── Sync activeSession prop → load history ────────────────────────────────
  useEffect(() => {
    console.log('[ThreadView] activeSession changed:', { 
      activeSession, 
      streamedSessionUuid: streamedSessionUuidRef.current 
    });

    // If activeSession matches the session we are actively streaming, do not reset
    if (activeSession && activeSession === streamedSessionUuidRef.current) {
      console.log('[ThreadView] activeSession matches streamedSessionUuid, skipping reload');
      return;
    }

    // Reset the stream ref as we are transitioning to a different session
    streamedSessionUuidRef.current = null;

    if (activeSession) {
      console.log('[ThreadView] Loading history for session:', activeSession);
      fetch('/api/sessions')
        .then((r) => r.json())
        .then((data) => {
          const s = data.find((x) => x.uuid === activeSession);
          if (s) setSessionTitle(s.title);
        })
        .catch(() => {});

      fetch(`/api/sessions/read?sessionUuid=${activeSession}`)
        .then((res) => res.json())
        .then((msgs) => {
          // Construct a linear tree chain of messages where each points to the previous one as parent.
          // This prevents the assistant-ui "Parent message not found" internal error.
          let lastId = null;
          const mapped = msgs.map((m, idx) => {
            const currentId = `msg-${idx}-${activeSession}`;
            const msg = {
              id: currentId,
              parentId: lastId,
              role: m.role,
              content: (m.content && Array.isArray(m.content) && m.content[0]) 
                ? m.content 
                : [{ type: 'text', text: typeof m.content === 'string' ? m.content : '' }]
            };
            lastId = currentId;
            return msg;
          });
          runtime.thread.reset(mapped);
        })
        .catch((err) => console.error('Failed to load session history:', err));
    } else {
      console.log('[ThreadView] Clearing history for New Thread');
      setSessionTitle('New Thread');
      runtime.thread.reset([]);
    }
  }, [activeSession, runtime]);

  // ── Poll history if the active session is running in the background ───────
  useEffect(() => {
    if (!activeSession) return;
    const isRunning = sessions?.find(s => s.uuid === activeSession)?.isRunning || false;
    if (!isRunning) return;

    console.log('[ThreadView] Active session is running in background, starting polling interval...');

    const fetchHistory = () => {
      fetch(`/api/sessions/read?sessionUuid=${activeSession}`)
        .then((res) => res.json())
        .then((msgs) => {
          let lastId = null;
          const mapped = msgs.map((m, idx) => {
            const currentId = `msg-${idx}-${activeSession}`;
            const msg = {
              id: currentId,
              parentId: lastId,
              role: m.role,
              content: (m.content && Array.isArray(m.content) && m.content[0]) 
                ? m.content 
                : [{ type: 'text', text: typeof m.content === 'string' ? m.content : '' }]
            };
            lastId = currentId;
            return msg;
          });

          // Only reset if history has changed to avoid screen flickering
          const currentMsgs = runtime.thread.messages;
          let changed = mapped.length !== currentMsgs.length;
          if (!changed && mapped.length > 0) {
            const lastMappedText = mapped[mapped.length - 1].content[0]?.text || '';
            const lastCurrentText = currentMsgs[currentMsgs.length - 1].content[0]?.text || '';
            if (lastMappedText !== lastCurrentText) {
              changed = true;
            }
          }
          if (changed) {
            console.log('[ThreadView] Background execution updated history, resetting thread messages.');
            runtime.thread.reset(mapped);
          }
        })
        .catch(() => {});
    };

    const interval = setInterval(fetchHistory, 2000);
    return () => clearInterval(interval);
  }, [activeSession, sessions, runtime]);

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [inputValue]);

  const handleSend = (overrideText) => {
    const text = typeof overrideText === 'string' ? overrideText.trim() : inputValue.trim();
    if (!text || isTyping) return;

    const currentUuid = activeSession || streamedSessionUuidRef.current || 'new';

    if (text.toLowerCase() === 'approve') {
      runtime.thread.append({ role: 'user', content: [{ type: 'text', text: 'Approve' }] });
      setIsTyping(true);

      fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionUuid: currentUuid }),
      })
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          // If approval request failed on the backend, append the error to UI
          runtime.thread.append({
            role: 'assistant',
            content: [{ type: 'text', text: '\n\n> **Error**: Failed to send approval.' }]
          });
          setIsTyping(false);
        }
      })
      .catch((err) => {
        console.error(err);
        setIsTyping(false);
      });
    } else {
      runtime.thread.append({ role: 'user', content: [{ type: 'text', text }] });
    }

    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleSelectPrompt = (promptText) => {
    setInputValue(promptText);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      handleSend(promptText);
    }, 100);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="thread-view-container">
      <div className="thread-header">
        <div className="header-title-section">
          <h2>{sessionTitle}</h2>
          {isTyping && (
            <span className="status-badge">
              <Loader2 size={12} className="spin" /> Agent Working
            </span>
          )}
        </div>
        <div className="model-selector-container">
          <select
            className="model-selector"
            value={selectedModel}
            onChange={(e) => {
              const model = e.target.value;
              setSelectedModel(model);
              const currentUuid = activeSession || streamedSessionUuidRef.current || 'new';
              localStorage.setItem(`qexow_model_${currentUuid}`, model);
            }}
          >
            {models.map(m => (
              <option key={m.slug} value={m.slug}>
                {m.display_name || m.slug}
              </option>
            ))}
          </select>

          <select
            className="reasoning-selector"
            value={selectedReasoning}
            onChange={(e) => {
              const reasoning = e.target.value;
              setSelectedReasoning(reasoning);
              const currentUuid = activeSession || streamedSessionUuidRef.current || 'new';
              localStorage.setItem(`qexow_reasoning_${currentUuid}`, reasoning);
            }}
          >
            <option value="default">Default Reasoning</option>
            <option value="low">Low Effort</option>
            <option value="medium">Medium Effort</option>
            <option value="high">High Effort</option>
            <option value="xhigh">X-High Effort</option>
          </select>

          <select
            className="speed-selector"
            value={selectedSpeed}
            onChange={(e) => {
              const speed = e.target.value;
              setSelectedSpeed(speed);
              const currentUuid = activeSession || streamedSessionUuidRef.current || 'new';
              localStorage.setItem(`qexow_speed_${currentUuid}`, speed);
            }}
          >
            <option value="default">Default Speed</option>
            <option value="fast">Fast</option>
          </select>
        </div>
      </div>

      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="assistant-ui-wrapper">
          <ThreadContent onSelectPrompt={handleSelectPrompt} />

          {/* ── Chat input dock — fixed bottom, full-width centered bar ── */}
          <div className="chat-input-dock">
            <div className="chat-input-inner">
              <div className="chat-input-box">
                <textarea
                  ref={textareaRef}
                  className="chat-textarea"
                  placeholder="Message Qexow… (Enter to send, Shift+Enter for newline)"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={isTyping}
                />
                <button
                  className={`send-btn ${inputValue.trim() && !isTyping ? 'active' : ''}`}
                  onClick={() => handleSend()}
                  disabled={!inputValue.trim() || isTyping}
                  title="Send message"
                >
                  {isTyping ? (
                    <Loader2 size={18} className="spin" />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </div>
              <p className="chat-hint">
                {isTyping
                  ? 'Agent is working…'
                  : 'Powered by Qexow · Type "Approve" to authorize actions'}
              </p>
            </div>
          </div>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
}
