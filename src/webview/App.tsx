import React, { useEffect, useRef, useCallback, useState } from 'react';
import { ChatContainer } from './components/ChatContainer';
import { WelcomeScreen } from './components/WelcomeScreen';
import { BottomInput } from './components/BottomInput';
import { ModelSelector } from './components/ModelSelector';
import { ModeSelector } from './components/ModeSelector';
import { ProviderPopup } from './components/ProviderPopup';
import { SessionListPopup } from './components/SessionListPopup';
import { ContextPart } from '../shared/types';
import { ConfirmDialog } from './components/ConfirmDialog';
import { postMessage } from './vscode-api';
import { CommandItem } from './slashCommands';
import { useChatState, genId } from './hooks/useChatState';
import { useModelManager } from './hooks/useModelManager';
import { resolvePromptModel } from './hooks/modelUtils';
import { useMessageHandler } from './hooks/useMessageHandler';
import { COLORS, RADIUS, btnIcon, card, flexRow, overlay, textHeader, textSmall } from './styles';
import { hoverable } from './hover';

interface AppErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, AppErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[opencode:webview] App render failed', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 24,
            color: COLORS.red,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export { AppErrorBoundary };

export default function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}

function AppContent() {
  const {
    messages,
    setMessages,
    busy,
    setBusy,
    contextEvents,
    setContextEvents,
    pendingChunkRef,
    chunkFlushTimerRef,
    streamingMsgIdRef,
    DEBOUNCE_MS,
    flushPendingChunk,
    cleanupStreaming,
    resetConversation,
  } = useChatState();

  const {
    model,
    setModel,
    mode,
    setMode,
    gitInfo,
    setGitInfo,
    availableModels,
    setAvailableModels,
    agentModels,
    setAgentModels,
    hiddenModels,
    setHiddenModels,
    providersLoaded,
    setProvidersLoaded,
    skills,
    setSkills,
    fileSearchResults,
    setFileSearchResults,
    fileSearchQuery,
    setFileSearchQuery,
    revertActive,
    setRevertActive,
    confirmDialog,
    setConfirmDialog,
    readPermissionPrompt,
    setReadPermissionPrompt,
    showProviders,
    setShowProviders,
    showSessions,
    setShowSessions,
    pendingRevertRef,
    toggleModelVisibility,
    handleToggleAllModels,
    processProviderList,
    tryAutoSelectModel,
  } = useModelManager();

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const fileSearchRequestIdRef = useRef<string | null>(null);

  /**
   * Empty until the server answers `GET /agent`. It must not be seeded with a
   * guess: the reconciler below treats the list as the truth about which modes
   * exist, so a placeholder makes it "correct" the mode into an agent the server
   * has never heard of, and the real list then corrects it back.
   */
  const [agents, setAgents] = useState<string[]>([]);
  const agentsLoadedRef = useRef(false);

  useMessageHandler({
    setMessages,
    setBusy,
    setContextEvents,
    pendingChunkRef,
    chunkFlushTimerRef,
    streamingMsgIdRef,
    DEBOUNCE_MS,
    flushPendingChunk,
    cleanupStreaming,
    setModel,
    setMode,
    setGitInfo,
    setAvailableModels,
    setAgentModels,
    setHiddenModels,
    setProvidersLoaded,
    setSkills,
    setFileSearchResults,
    setFileSearchQuery,
    fileSearchRequestIdRef,
    setRevertActive,
    setConfirmDialog,
    setReadPermissionPrompt,
    setAgents,
    onAgentsLoaded: () => {
      agentsLoadedRef.current = true;
    },
    processProviderList,
    tryAutoSelectModel,
  });

  /**
   * Agents may pin their own model. Selecting one seeds the picker with that
   * model so the shown value matches what the server will run; the user can then
   * change it and the picker wins, because the request model beats the agent pin.
   */
  const selectMode = useCallback(
    (next: string) => {
      setMode(next);
      const pinned = agentModels[next];
      if (pinned) setModel(pinned);
    },
    [agentModels, setMode, setModel],
  );

  useEffect(() => {
    /**
     * Moves off a mode the server does not offer, but only once it has actually
     * said what it offers.
     *
     * The previous default list (`build`, `plan`, …) made this effect fire on
     * mount, before `agentList` arrived: the real mode was not in the guess, so
     * it switched to `build`; the real list then contained neither, so it
     * switched back — two system messages per open, and a mode flip the user
     * never asked for. Worse, `agents[0]` is not a fallback the user can have
     * meant, so it is only correct when the current mode is genuinely gone.
     */
    if (!agentsLoadedRef.current) return;
    if (agents.length === 0) return;
    // No mode yet means the user has not picked one on this machine, so adopt
    // the server's first agent silently rather than reporting a switch.
    if (!mode) {
      selectMode(agents[0]!);
      return;
    }
    if (agents.includes(mode)) return;
    // Keep the mode if the server's list is merely incomplete. Only a mode the
    // server does not know at all is switched away from, and then to the first
    // agent it did offer.
    const next = agents[0]!;
    if (next === mode) return;
    selectMode(next);
    setMessages((prev) => [
      ...prev,
      {
        role: 'system',
        content: `Mode "${mode}" is not available on this server. Switched to "${next}".`,
        timestamp: Date.now(),
        id: genId(),
      },
    ]);
  }, [agents, mode, selectMode, setMessages]);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: busy ? 'auto' : 'smooth' });
  }, [messages, contextEvents, busy]);

  useEffect(() => {
    postMessage({ type: 'webviewReady' });
  }, []);

  const handleSend = useCallback(
    (prompt: string, context?: ContextPart[]) => {
      /**
       * Sends for a given agent. A mode other than the active one has not been
       * through the picker yet, so it contributes its own pin. A send with no
       * model at all would let the server fall back to the agent's default, so
       * it is refused instead of quietly running on something else.
       */
      const send = (promptText: string, modeName: string) => {
        const target = resolvePromptModel(modeName, mode, model, agentModels);
        if (!target) {
          setBusy(false);
          setMessages((prev) => [
            ...prev,
            {
              role: 'system',
              content: 'No model selected yet. Pick a model before sending.',
              timestamp: Date.now(),
              id: genId(),
            },
          ]);
          return;
        }
        postMessage({ type: 'sendMessage', payload: { prompt: promptText, model: target, mode: modeName, context } });
      };
      nearBottomRef.current = true;
      setBusy(true);
      setContextEvents([]);
      const firstWord = prompt.split(' ')[0];
      if (firstWord.startsWith('/')) {
        const cmdName = firstWord.slice(1);
        const rest = prompt.slice(firstWord.length).trim();
        const skill = skills.some((s) => s.name === cmdName);
        if (skill) {
          postMessage({ type: 'runCommand', payload: { command: cmdName, args: rest, isSkill: true } });
          return;
        }
        if (cmdName === 'init') {
          postMessage({ type: 'runCommand', payload: { command: cmdName, args: rest } });
          return;
        }
        if (cmdName === 'review') {
          if (rest) {
            selectMode('review');
            send(rest, 'review');
            return;
          }
          postMessage({ type: 'runCommand', payload: { command: cmdName, args: '' } });
          return;
        }
        if (agents.includes(cmdName)) {
          selectMode(cmdName);
          if (rest) {
            send(rest, cmdName);
            return;
          }
          setBusy(false);
          return;
        }
      }
      send(prompt, mode);
    },
    [agentModels, model, mode, skills, agents, setBusy, setContextEvents, selectMode, setMessages],
  );

  const handleOpenDiff = useCallback((filePath: string) => {
    postMessage({ type: 'openDiff', payload: { filePath } });
  }, []);

  const handleAbort = useCallback(() => {
    postMessage({ type: 'abort' });
    // Drop buffered chunks too: otherwise a pending debounce timer flushes the
    // aborted turn's text back into the transcript after the user stops it.
    cleanupStreaming();
    setBusy(false);
  }, [cleanupStreaming, setBusy]);

  /**
   * Starts a fresh session while keeping the previous one in session history.
   *
   * The extension side already does the right thing: `clearChat` dispatches to
   * `SessionService.abort()`, which stops the server stream and nulls
   * `_currentSessionId`, so the next prompt creates a brand new session. This
   * callback only has to clear the webview's own copy of the conversation.
   */
  const handleNewChat = useCallback(() => {
    resetConversation();
    setRevertActive(false);
    setReadPermissionPrompt(null);
    setConfirmDialog(null);
    setShowSessions(false);
    postMessage({ type: 'clearChat' });
  }, [resetConversation, setRevertActive, setReadPermissionPrompt, setConfirmDialog, setShowSessions]);

  const handleRevert = useCallback(
    (messageId: string) => {
      pendingRevertRef.current = messageId;
      setConfirmDialog({
        message: 'Revert to this message? This will undo all file changes made after it.',
        onConfirm: () => {
          const id = pendingRevertRef.current;
          pendingRevertRef.current = null;
          if (id) postMessage({ type: 'revertMessage', payload: { messageId: id } });
        },
      });
    },
    [setConfirmDialog],
  );

  const handleUnrevert = useCallback(() => {
    postMessage({ type: 'unrevert' });
  }, []);

  const handleSlashCommand = useCallback(
    (cmd: CommandItem) => {
      if (cmd.command === 'new') {
        handleNewChat();
      } else if (cmd.command === 'init' || cmd.command === 'review') {
        postMessage({ type: 'runCommand', payload: { command: cmd.command, args: '' } });
      } else if (cmd.agent && agents.includes(cmd.agent)) {
        selectMode(cmd.agent);
      }
    },
    [agents, selectMode, handleNewChat],
  );

  const handleRespondPermission = useCallback(
    (permId: string, permSessionId: string, response: 'allow' | 'deny', remember?: boolean) => {
      postMessage({ type: 'respondPermission', payload: { permId, permSessionId, response, remember } });
    },
    [],
  );

  const handleRespondReadPermission = useCallback(
    (response: 'allow' | 'deny', remember?: boolean) => {
      if (!readPermissionPrompt) return;
      postMessage({
        type: 'respondReadPermission',
        payload: { filePath: readPermissionPrompt.filePath, response, remember },
      });
      setReadPermissionPrompt(null);
    },
    [readPermissionPrompt, setReadPermissionPrompt],
  );

  const handleLoadSession = useCallback(
    (sessionId: string) => {
      setMessages([]);
      setShowSessions(false);
      postMessage({ type: 'loadSession', payload: { sessionId } });
    },
    [setMessages, setShowSessions],
  );

  const showWelcome = messages.length === 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: COLORS.bg,
        position: 'relative',
      }}
    >
      <div
        ref={chatScrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
      >
        {showWelcome ? (
          <WelcomeScreen
            projectPath={gitInfo.projectPath}
            branch={gitInfo.branch}
            lastCommitTime={gitInfo.lastCommitTime}
          />
        ) : (
          <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', padding: '16px 12px' }}>
            <ChatContainer
              messages={messages}
              onRevert={handleRevert}
              revertActive={revertActive}
              onUnrevert={handleUnrevert}
              contextEvents={contextEvents}
              onLoadSession={handleLoadSession}
              onRespondPermission={handleRespondPermission}
              onOpenDiff={handleOpenDiff}
              availableModels={availableModels}
            />
          </div>
        )}
      </div>

      {busy && (
        <div
          style={{
            padding: '8px 16px',
            fontSize: 12,
            color: COLORS.accent,
            backgroundColor: COLORS.bgLight,
            textAlign: 'center',
            borderTop: `1px solid ${COLORS.bgHover}`,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: COLORS.accent,
              marginRight: 8,
              animation: 'pulse 1s infinite',
              verticalAlign: 'middle',
            }}
          />{' '}
          Processing...
          <button
            onClick={handleAbort}
            style={{
              marginLeft: 12,
              padding: '2px 8px',
              borderRadius: RADIUS.sm,
              border: `1px solid ${COLORS.border}`,
              backgroundColor: 'transparent',
              color: COLORS.red,
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Abort
          </button>
        </div>
      )}

      <div>
        <BottomInput
          onSend={handleSend}
          disabled={busy}
          onSearchFiles={(query, requestId) => {
            fileSearchRequestIdRef.current = requestId;
            postMessage({ type: 'searchFiles', payload: { query, requestId } });
          }}
          fileSearchResults={fileSearchResults}
          fileSearchQuery={fileSearchQuery}
          onSlashCommand={handleSlashCommand}
          skills={skills}
          agents={agents}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px 12px',
            backgroundColor: COLORS.bgLight,
            borderTop: `1px solid ${COLORS.bgHover}`,
          }}
        >
          <ModeSelector mode={mode} onChange={selectMode} agents={agents} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={handleNewChat}
              aria-label="New Chat"
              style={btnIcon}
              {...hoverable({ color: COLORS.text }, { color: COLORS.textMuted })}
              title="New Chat"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              onClick={() => setShowSessions(true)}
              aria-label="Session History"
              style={btnIcon}
              {...hoverable({ color: COLORS.text }, { color: COLORS.textMuted })}
              title="Session History"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            {providersLoaded ? (
              <ModelSelector
                model={model}
                onChange={setModel}
                availableModels={availableModels.filter((m) => !hiddenModels[m.id])}
              />
            ) : (
              <span style={{ ...textSmall, padding: '4px 8px' }}>Loading...</span>
            )}
            <button
              onClick={() => setShowProviders(true)}
              aria-label="Provider Settings"
              style={{
                ...btnIcon,
                color: showProviders ? COLORS.accent : COLORS.textMuted,
                transition: 'color 0.15s',
              }}
              {...hoverable({ color: COLORS.text }, () => ({
                color: showProviders ? COLORS.accent : COLORS.textMuted,
              }))}
              title="Provider Settings"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {showProviders && (
        <ProviderPopup
          onClose={() => {
            setShowProviders(false);
            postMessage({ type: 'listProviders' });
          }}
          onModelSelect={(providerId, modelId) => {
            setModel(`${providerId}/${modelId}`);
            setShowProviders(false);
          }}
          availableModels={availableModels}
          hiddenModels={hiddenModels}
          onToggleModel={toggleModelVisibility}
          onToggleAllModels={handleToggleAllModels}
        />
      )}

      {showSessions && <SessionListPopup onClose={() => setShowSessions(false)} onSelect={handleLoadSession} />}

      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {readPermissionPrompt && (
        <div style={overlay}>
          <div style={card}>
            <div style={{ ...textHeader, color: COLORS.red }}>Read Permission Required</div>
            <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 4 }}>The AI wants to read this file:</div>
            <div
              style={{
                fontSize: 13,
                color: COLORS.accent,
                fontFamily: 'monospace',
                padding: '8px 12px',
                backgroundColor: COLORS.bg,
                borderRadius: RADIUS.md,
                marginBottom: 8,
                wordBreak: 'break-all',
              }}
            >
              {readPermissionPrompt.filePath}
            </div>
            <div style={{ ...textSmall, marginBottom: 16 }}>{readPermissionPrompt.reason}</div>
            <div style={{ ...flexRow, justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => handleRespondReadPermission('deny')}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: `1px solid ${COLORS.border}`,
                  backgroundColor: 'transparent',
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Deny
              </button>
              <button
                onClick={() => handleRespondReadPermission('allow')}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: COLORS.green,
                  color: COLORS.onBright,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Allow Once
              </button>
              <button
                onClick={() => handleRespondReadPermission('allow', true)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: COLORS.accent,
                  color: COLORS.onBright,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Always Allow
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
