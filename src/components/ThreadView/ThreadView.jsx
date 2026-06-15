import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Terminal, Copy, Check, ArrowDown, Square } from 'lucide-react';
import { AssistantRuntimeProvider, useLocalRuntime, ThreadPrimitive, MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { MarkdownTextPrimitive, useIsMarkdownCodeBlock } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { desktopApi } from '../../lib/desktopApi';
import { appendRuntimeDiagnosticsHint } from '../../lib/runtimeMessaging';
import './ThreadView.css';

// AsyncQueue bridges Tauri process events to assistant-ui async generators.
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

const WelcomeScreen = () => {
  return (
    <div className="welcome-container">
      <div className="welcome-header animate-fade-in">
        <div className="welcome-logo-glow">
          <Terminal size={32} className="welcome-logo-icon" />
        </div>
        <h1 className="welcome-title">How can I help you today?</h1>
        <p className="welcome-subtitle">Ask AxiOwl to inspect the workspace, edit files, or run Codex tasks against the active project.</p>
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
const ThreadContent = () => {
  const messages = useAuiState(s => s.thread.messages);
  const isEmpty = messages.length === 0;

  if (isEmpty) {
    return <WelcomeScreen />;
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

function mapHistoryMessages(messages, sessionId) {
  let lastId = null;
  return messages.map((message, index) => {
    const currentId = `msg-${index}-${sessionId}`;
    const mapped = {
      id: currentId,
      parentId: lastId,
      role: message.role,
      content: (message.content && Array.isArray(message.content) && message.content[0])
        ? message.content
        : [{ type: 'text', text: typeof message.content === 'string' ? message.content : '' }]
    };
    lastId = currentId;
    return mapped;
  });
}

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

export default function ThreadView({ activeSession, newThreadResetKey, sessions, onFileOpen, onTerminalOutput, activeFileContent, activeFilePath, lastTerminalOutputRef, onDiffReceived, onSessionCreated, onSessionFinished, onModelInfoChanged, onTokenUsageUpdated, onAuthExpired, activeModel, activeContextWindow, activeSessionUsage, codexRuntimeStatus }) {
  const [isTyping, setIsTyping] = useState(false);
  const [isAwaitingApproval, setIsAwaitingApproval] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('New Thread');
  const [inputValue, setInputValue] = useState('');
  const [sessionStatusMessage, setSessionStatusMessage] = useState(null);
  const initialSelectedModel = localStorage.getItem(`axiowl_model_${activeSession || 'new'}`) || '';
  
  const textareaRef = useRef(null);

  // Keep track of the active session we are streaming to avoid race conditions
  const streamedSessionUuidRef = useRef(null);
  const activeRunIdRef = useRef(null);
  // Keep track of the activeSession prop in a ref for callback access
  const activeSessionRef = useRef(activeSession);
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onSessionFinishedRef = useRef(onSessionFinished);
  const onDiffReceivedRef = useRef(onDiffReceived);
  const onFileOpenRef = useRef(onFileOpen);
  const onTerminalOutputRef = useRef(onTerminalOutput);
  const onTokenUsageUpdatedRef = useRef(onTokenUsageUpdated);
  const onAuthExpiredRef = useRef(onAuthExpired);
  const pendingNewSessionPromptRef = useRef('');
  const loadedThreadKeyRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  useEffect(() => { onSessionCreatedRef.current = onSessionCreated; }, [onSessionCreated]);
  useEffect(() => { onSessionFinishedRef.current = onSessionFinished; }, [onSessionFinished]);
  useEffect(() => { onDiffReceivedRef.current = onDiffReceived; }, [onDiffReceived]);
  useEffect(() => { onFileOpenRef.current = onFileOpen; }, [onFileOpen]);
  useEffect(() => { onTerminalOutputRef.current = onTerminalOutput; }, [onTerminalOutput]);
  useEffect(() => { onTokenUsageUpdatedRef.current = onTokenUsageUpdated; }, [onTokenUsageUpdated]);
  useEffect(() => { onAuthExpiredRef.current = onAuthExpired; }, [onAuthExpired]);

  const [models, setModels] = useState([]);
  const [modelsError, setModelsError] = useState(null);

  const [selectedModel, setSelectedModel] = useState(initialSelectedModel);

  const [selectedReasoning, setSelectedReasoning] = useState(() => {
    const saved = localStorage.getItem(`axiowl_reasoning_${activeSession || 'new'}`);
    return saved || 'default';
  });

  const [selectedSpeed, setSelectedSpeed] = useState(() => {
    const saved = localStorage.getItem(`axiowl_speed_${activeSession || 'new'}`);
    return saved || 'default';
  });

  // Fetch dynamic models on mount
  useEffect(() => {
    desktopApi.getModels()
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setModels(data);
          setModelsError(null);
          if (!selectedModel || !data.some((model) => model.slug === selectedModel)) {
            setSelectedModel(data[0].slug);
          }
        } else {
          setModels([]);
          setModelsError(appendRuntimeDiagnosticsHint('Codex returned no models.', codexRuntimeStatus));
        }
      })
      .catch(err => {
        console.error('Failed to fetch models:', err);
        setModels([]);
        setModelsError(appendRuntimeDiagnosticsHint(
          err.message || 'Model catalog unavailable.',
          codexRuntimeStatus,
        ));
      });
  }, [codexRuntimeStatus]);

  useEffect(() => {
    const currentUuid = activeSession || 'new';
    const savedModel = localStorage.getItem(`axiowl_model_${currentUuid}`);
    if (savedModel && models.some((model) => model.slug === savedModel)) {
      setSelectedModel(savedModel);
    } else if (models.length > 0) {
      const fallbackModel = models[0].slug;
      setSelectedModel(fallbackModel);
      localStorage.setItem(`axiowl_model_${currentUuid}`, fallbackModel);
    } else {
      setSelectedModel('');
    }

    const savedReasoning = localStorage.getItem(`axiowl_reasoning_${activeSession || 'new'}`);
    setSelectedReasoning(savedReasoning || 'default');

    const savedSpeed = localStorage.getItem(`axiowl_speed_${activeSession || 'new'}`);
    setSelectedSpeed(savedSpeed || 'default');
  }, [activeSession, models]);

  useEffect(() => {
    const activeModelObj = models.find(m => m.slug === selectedModel);
    const context = activeModelObj?.context_window ?? null;
    if (onModelInfoChanged) {
      onModelInfoChanged(selectedModel || null, context);
    }
  }, [selectedModel, models, onModelInfoChanged]);

  const syncThreadFromHistory = async (sessionId) => {
    if (!sessionId) return;
    const messages = await desktopApi.readSessionHistory(sessionId);
    runtime.thread.reset(mapHistoryMessages(messages, sessionId));
    setSessionStatusMessage(null);
  };

  useEffect(() => {
    if (activeSession !== null) {
      return;
    }
    streamedSessionUuidRef.current = null;
    activeRunIdRef.current = null;
    loadedThreadKeyRef.current = '__new__';
    setSessionTitle('New Thread');
    setSessionStatusMessage(null);
    setIsTyping(false);
    setIsAwaitingApproval(false);
    runtime.thread.reset([]);
  }, [activeSession, newThreadResetKey]);

  const runtime = useLocalRuntime({
    async *run({ messages }) {
      setIsTyping(true);
      const lastMessage = messages[messages.length - 1];
      const prompt = lastMessage.content[0]?.text || '';
      pendingNewSessionPromptRef.current = prompt;

      // Context injection: prepend active file + last terminal output
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
      const storedModel = localStorage.getItem(`axiowl_model_${currentUuid}`);
      const currentModel = storedModel && models.some((model) => model.slug === storedModel)
        ? storedModel
        : selectedModel || models[0]?.slug || null;
      const currentReasoning =
        localStorage.getItem(`axiowl_reasoning_${currentUuid}`) || 'default';
      const currentSpeed =
        localStorage.getItem(`axiowl_speed_${currentUuid}`) || 'default';

      const queue = new AsyncQueue();
      let unlisten = null;
      let currentRunId = null;
      try {
        setIsAwaitingApproval(false);
        unlisten = await desktopApi.onCodexEvent((envelope) => {
          if (!currentRunId || envelope.runId === currentRunId) {
            queue.push(desktopApi.normalizeCodexEvent(envelope));
          }
        });
        const started = await desktopApi.executePrompt({
          prompt: enrichedPrompt,
          sessionUuid: currentUuid,
          model: currentModel,
          reasoning: currentReasoning,
          speed: currentSpeed,
        });
        currentRunId = started.runId;
        activeRunIdRef.current = currentRunId;
      } catch (err) {
        if (unlisten) unlisten();
        setIsTyping(false);
        if (isAuthExpiredError(err.message || err)) {
          onAuthExpiredRef.current?.(err.message || String(err));
        }
        const launchError = appendRuntimeDiagnosticsHint(
          err.message || 'Could not launch codex CLI.',
          codexRuntimeStatus,
        );
        yield {
          content: [{ type: 'text', text: `> **Error**: ${launchError}` }],
        };
        return;
      }

      let fullResponse = '';
      try {
        while (true) {
          const event = await queue.pop();

          if (event.type === 'thread.started') {
            const newUuid = event.thread_id;
            streamedSessionUuidRef.current = newUuid;

            const modelToSave = localStorage.getItem('axiowl_model_new') || currentModel;
            if (modelToSave) {
              localStorage.setItem(`axiowl_model_${newUuid}`, modelToSave);
            }

            const reasoningToSave = localStorage.getItem('axiowl_reasoning_new') || 'default';
            localStorage.setItem(`axiowl_reasoning_${newUuid}`, reasoningToSave);

            const speedToSave = localStorage.getItem('axiowl_speed_new') || 'default';
            localStorage.setItem(`axiowl_speed_${newUuid}`, speedToSave);

            if (!activeSessionRef.current && onSessionCreatedRef.current) {
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
            setIsAwaitingApproval(true);
            const commandLabel = event.command || 'a protected command';
            fullResponse += `\n\n> **Action Required**: Codex wants to run \`${commandLabel}\`.\n\nType **Approve** to authorize this action.\n`;
            yield { content: [{ type: 'text', text: fullResponse }] };
          } else if (event.type === 'diff') {
            if (onDiffReceivedRef.current) onDiffReceivedRef.current(event);
            // Auto-open the modified file in the editor
            if (event.absolutePath && onFileOpenRef.current) {
              onFileOpenRef.current(event.absolutePath);
            }
            fullResponse += `\n\n> **File Changed**: \`${event.file}\` - opened in editor.\n`;
            yield { content: [{ type: 'text', text: fullResponse }] };
          } else if (event.type === 'terminal_output') {
            const cmd = event.command ? `$ ${event.command}` : '';
            const out = typeof event.output === 'string'
              ? event.output
              : String(event.output ?? '');
            const termText = [cmd, out].filter(Boolean).join('\n');
            // Accumulate terminal output for next context injection
            if (onTerminalOutputRef.current) onTerminalOutputRef.current(termText);
            if (lastTerminalOutputRef) lastTerminalOutputRef.current = termText;
            // Show inline as a collapsible terminal block
            if (cmd || out) {
              if (event.status === 'declined') {
                fullResponse += `\n\n> **Command Blocked**: Codex policy rejected \`${event.command || 'the requested command'}\`.\n`;
              } else if (event.status === 'failed') {
                fullResponse += `\n\n> **Command Failed**: \`${event.command || 'shell command'}\` exited with status ${event.exit_code ?? 'unknown'}.\n`;
              }
              fullResponse += `\n\n<details><summary>Terminal: <code>${event.command || 'shell'}</code></summary>\n\n\`\`\`\n${out}\n\`\`\`\n</details>\n`;
              yield { content: [{ type: 'text', text: fullResponse }] };
            }
          } else if (event.type === 'token_count') {
            const totalUsed = event.info?.total_token_usage?.total_tokens
              ?? (
                ((event.info?.total_token_usage?.input_tokens) || 0)
                + ((event.info?.total_token_usage?.output_tokens) || 0)
              );
            if (onTokenUsageUpdatedRef.current) {
              onTokenUsageUpdatedRef.current(totalUsed);
            }
          } else if (event.type === 'stderr_message') {
            if (isAuthExpiredError(event.content)) {
              onAuthExpiredRef.current?.(event.content);
            }
          } else if (event.type === 'end') {
            setIsTyping(false);
            setIsAwaitingApproval(false);
            activeRunIdRef.current = null;
            const completedSessionId = activeSessionRef.current || streamedSessionUuidRef.current;
              if (completedSessionId) {
                try {
                  await syncThreadFromHistory(completedSessionId);
                } catch (historyError) {
                  console.error('Failed to refresh completed session history:', historyError);
                  setSessionStatusMessage(
                    `Could not refresh completed session history. ${historyError.message || 'History reload failed.'}`
                  );
                }
              }
            if (onSessionFinishedRef.current) onSessionFinishedRef.current();
            break;
          } else if (event.type === 'cancelled') {
            setIsTyping(false);
            setIsAwaitingApproval(false);
            activeRunIdRef.current = null;
            const completedSessionId = activeSessionRef.current || streamedSessionUuidRef.current;
              if (completedSessionId) {
                try {
                  await syncThreadFromHistory(completedSessionId);
                } catch (historyError) {
                  console.error('Failed to refresh cancelled session history:', historyError);
                  setSessionStatusMessage(
                    `Could not refresh cancelled session history. ${historyError.message || 'History reload failed.'}`
                  );
                }
              }
            if (onSessionFinishedRef.current) onSessionFinishedRef.current();
            if (fullResponse.trim()) {
              fullResponse += '\n\n> **Cancelled**: Run stopped before completion.';
              yield { content: [{ type: 'text', text: fullResponse }] };
            } else {
              runtime.thread.append({
                role: 'assistant',
                content: [{ type: 'text', text: '> **Cancelled**: Run stopped before completion.' }]
              });
            }
            break;
          } else if (event.type === 'error' || event.type === 'turn.failed') {
            setIsTyping(false);
            setIsAwaitingApproval(false);
            activeRunIdRef.current = null;
            const completedSessionId = activeSessionRef.current || streamedSessionUuidRef.current;
              if (completedSessionId) {
                try {
                  await syncThreadFromHistory(completedSessionId);
                } catch (historyError) {
                  console.error('Failed to refresh errored session history:', historyError);
                  setSessionStatusMessage(
                    `Could not refresh session history after the error. ${historyError.message || 'History reload failed.'}`
                  );
                }
              }
            if (onSessionFinishedRef.current) onSessionFinishedRef.current();
            const errorText =
              event.error?.message ||
              event.error ||
              event.message ||
              'Connection to codex stream lost.';
            const displayError = appendRuntimeDiagnosticsHint(errorText, codexRuntimeStatus);
            if (isAuthExpiredError(errorText)) {
              onAuthExpiredRef.current?.(errorText);
            }
            fullResponse += `\n\n> **Error**: ${displayError}`;
            yield { content: [{ type: 'text', text: fullResponse }] };
            break;
          }
        }
      } finally {
        if (unlisten) unlisten();
        setIsTyping(false);
        setIsAwaitingApproval(false);
      }
    }
  });

  // Sync activeSession prop -> load history
  useEffect(() => {
    // If activeSession matches the session we are actively streaming, do not reset
    if (activeSession && activeSession === streamedSessionUuidRef.current) {
      return;
    }

    const targetThreadKey = activeSession || '__new__';
    if (loadedThreadKeyRef.current === targetThreadKey) {
      return;
    }
    loadedThreadKeyRef.current = targetThreadKey;

    // Reset the stream ref as we are transitioning to a different session
    streamedSessionUuidRef.current = null;

      if (activeSession) {
        desktopApi.getSessions()
          .then((data) => {
            const s = data.find((x) => x.uuid === activeSession);
            if (s) setSessionTitle(s.title);
          })
        .catch((err) => console.error('Failed to load session list for active session:', err));

      syncThreadFromHistory(activeSession)
        .catch((err) => {
          console.error('Failed to load session history:', err);
          setSessionStatusMessage(
            `Could not load session history for this thread. ${err.message || 'History read failed.'}`
          );
        });
    } else {
      setSessionTitle('New Thread');
      setSessionStatusMessage(null);
      runtime.thread.reset([]);
    }
  }, [activeSession, runtime]);

  // Poll history if the active session is running in the background
  useEffect(() => {
    if (!activeSession) return;
    const isRunning = sessions?.find(s => s.uuid === activeSession)?.isRunning || false;
    if (!isRunning) return;

    const fetchHistory = () => {
      desktopApi.readSessionHistory(activeSession)
        .then((msgs) => {
          const mapped = mapHistoryMessages(msgs, activeSession);
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
            runtime.thread.reset(mapped);
          }
          setSessionStatusMessage(null);
        })
        .catch((err) => {
          console.error('Failed to poll background session history:', err);
          setSessionStatusMessage(
            `Could not refresh background session history. ${err.message || 'History polling failed.'}`
          );
        });
    };

    const interval = setInterval(fetchHistory, 2000);
    return () => clearInterval(interval);
  }, [activeSession, sessions, runtime]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [inputValue]);

  const handleSend = (overrideText) => {
    const text = typeof overrideText === 'string' ? overrideText.trim() : inputValue.trim();
    const isApprovalReply = isAwaitingApproval && text.toLowerCase() === 'approve';
    if (!text) return;
    if (isTyping && !isApprovalReply) return;

    if (isApprovalReply) {
      runtime.thread.append({ role: 'user', content: [{ type: 'text', text: 'Approve' }] });
      setIsTyping(true);
      setIsAwaitingApproval(false);

      const runId = activeRunIdRef.current;
        if (!runId) {
          runtime.thread.append({
            role: 'assistant',
            content: [{ type: 'text', text: '\n\n> **Error**: No active run is currently waiting for approval input.' }]
          });
          setIsTyping(false);
          setInputValue('');
          return;
      }

      desktopApi.approveRun(runId)
      .then(data => {
        if (!data.success) {
          // If approval request failed on the backend, append the error to UI
          runtime.thread.append({
            role: 'assistant',
            content: [{ type: 'text', text: '\n\n> **Error**: Approval could not be sent to the active Codex run.' }]
          });
          setIsTyping(false);
        }
      })
      .catch((err) => {
        console.error(err);
        setIsTyping(false);
        setIsAwaitingApproval(false);
      });
    } else {
      runtime.thread.append({ role: 'user', content: [{ type: 'text', text }] });
    }

    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleCancelRun = () => {
    const runId = activeRunIdRef.current;
    if (!runId) return;
    setIsAwaitingApproval(false);
    desktopApi.cancelRun(runId)
      .catch((err) => {
        console.error('[ThreadView] Failed to cancel run:', err);
        runtime.thread.append({
          role: 'assistant',
          content: [{ type: 'text', text: `\n\n> **Error**: ${err.message || 'The active Codex run could not be cancelled.'}` }]
        });
        activeRunIdRef.current = null;
        setIsTyping(false);
        setIsAwaitingApproval(false);
        if (onSessionFinishedRef.current) onSessionFinishedRef.current();
      });
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
          {isTyping && (
            <button className="stop-run-btn" onClick={handleCancelRun} title="Stop active run">
              <Square size={12} /> Stop
            </button>
          )}
        </div>
        <div className="model-selector-container">
          <select
            className="model-selector"
            value={selectedModel}
            disabled={models.length === 0}
            onChange={(e) => {
              const model = e.target.value;
              setSelectedModel(model);
              const currentUuid = activeSession || streamedSessionUuidRef.current || 'new';
              localStorage.setItem(`axiowl_model_${currentUuid}`, model);
            }}
          >
            {models.length === 0 && <option value="">Models unavailable</option>}
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
              localStorage.setItem(`axiowl_reasoning_${currentUuid}`, reasoning);
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
              localStorage.setItem(`axiowl_speed_${currentUuid}`, speed);
            }}
          >
            <option value="default">Default Speed</option>
            <option value="fast">Fast</option>
          </select>
        </div>
        {modelsError && (
          <span className="usage-text-muted models-error-message">
            {modelsError}
          </span>
        )}
      </div>
      {sessionStatusMessage && (
        <div className="thread-status-banner error">
          {sessionStatusMessage}
        </div>
      )}

      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="assistant-ui-wrapper">
          <ThreadContent />

          {/* Chat input dock */}
          <div className="chat-input-dock">
            <div className="chat-input-inner">
              <div className="chat-input-box">
                <textarea
                  ref={textareaRef}
                  className="chat-textarea"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={isTyping && !isAwaitingApproval}
                  aria-label="Message AxiOwl"
                />
                <button
                  className={`send-btn ${inputValue.trim() && !isTyping ? 'active' : ''}`}
                  onClick={() => handleSend()}
                  disabled={!inputValue.trim() || (isTyping && !isAwaitingApproval)}
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
                {isAwaitingApproval
                  ? 'Approval requested above. Type "Approve" to continue.'
                  : isTyping
                    ? 'Agent is working...'
                    : 'Powered by AxiOwl'}
              </p>
              {(activeModel || activeSessionUsage != null || activeContextWindow != null) && (
                <div className="chat-input-usage">
                  {activeModel && (
                    <span className="chat-usage-model">{activeModel}</span>
                  )}
                  {activeModel && (activeSessionUsage != null || activeContextWindow != null) && (
                    <span className="chat-usage-divider">-</span>
                  )}
                  {activeSessionUsage != null && activeContextWindow != null && (
                    <>
                      <span className="chat-usage-tokens">
                        {activeSessionUsage.toLocaleString()} / {activeContextWindow.toLocaleString()} tokens
                      </span>
                      <span className="chat-usage-divider">-</span>
                      <span className="chat-usage-remaining">
                        {Math.max(0, activeContextWindow - activeSessionUsage).toLocaleString()} remaining
                      </span>
                    </>
                  )}
                  {activeSessionUsage == null && activeContextWindow != null && (
                    <span className="chat-usage-tokens">
                      Context window {activeContextWindow.toLocaleString()} tokens
                    </span>
                  )}
                  {activeSessionUsage != null && activeContextWindow == null && (
                    <span className="chat-usage-tokens">
                      {activeSessionUsage.toLocaleString()} tokens used
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
}
