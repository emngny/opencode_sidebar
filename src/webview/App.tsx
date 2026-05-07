import React, { useEffect, useRef, useCallback } from 'react';
import { ChatContainer } from './components/ChatContainer';
import { WelcomeScreen } from './components/WelcomeScreen';
import { BottomInput } from './components/BottomInput';
import { ModelSelector } from './components/ModelSelector';
import { ModeSelector } from './components/ModeSelector';
import { ProviderPopup } from './components/ProviderPopup';
import { SessionListPopup } from './components/SessionListPopup';
import { ContextPart } from '../extension/types';
import { ConfirmDialog } from './components/ConfirmDialog';
import { postMessage } from './vscode-api';
import { CommandItem } from './slashCommands';
import { useChatState } from './hooks/useChatState';
import { useModelManager } from './hooks/useModelManager';
import { useMessageHandler } from './hooks/useMessageHandler';

export default function App() {
  const {
    messages, setMessages, busy, setBusy, contextEvents, setContextEvents,
    pendingChunkRef, chunkFlushTimerRef, streamingMsgIdRef, DEBOUNCE_MS,
    flushPendingChunk, cleanupStreaming,
  } = useChatState();

  const {
    model, setModel, mode, setMode,
    gitInfo, setGitInfo,
    availableModels, setAvailableModels,
    hiddenModels, setHiddenModels,
    providersLoaded, setProvidersLoaded,
    skills, setSkills,
    fileSearchResults, setFileSearchResults,
    fileSearchQuery, setFileSearchQuery,
    revertActive, setRevertActive,
    confirmDialog, setConfirmDialog,
    readPermissionPrompt, setReadPermissionPrompt,
    showProviders, setShowProviders,
    showSessions, setShowSessions,
    pendingRevertRef,
    toggleModelVisibility, handleToggleAllModels,
    processProviderList, tryAutoSelectModel,
  } = useModelManager();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useMessageHandler({
    setMessages, setBusy, setContextEvents,
    pendingChunkRef, chunkFlushTimerRef, streamingMsgIdRef, DEBOUNCE_MS,
    flushPendingChunk, cleanupStreaming,
    setModel, setMode, setGitInfo, setAvailableModels, setHiddenModels,
    setProvidersLoaded, setSkills, setFileSearchResults, setFileSearchQuery,
    setRevertActive, setConfirmDialog, setReadPermissionPrompt,
    processProviderList, tryAutoSelectModel,
  });

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    postMessage({ type: 'webviewReady' });
  }, []);

  const handleSend = useCallback((prompt: string, context?: ContextPart[]) => {
    console.log('[webview] Sending prompt:', prompt, 'context:', context?.length || 0, 'items');
    setBusy(true);
    setContextEvents([]);
    const firstWord = prompt.split(' ')[0];
    if (firstWord.startsWith('/')) {
      const cmdName = firstWord.slice(1);
      const rest = prompt.slice(firstWord.length).trim();
      const skill = skills.find((s) => s.name === cmdName);
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
          setMode('Review');
          postMessage({ type: 'sendMessage', payload: { prompt: rest, model, mode: 'Review', context } });
          return;
        }
        postMessage({ type: 'runCommand', payload: { command: cmdName, args: '' } });
        return;
      }
      const modeMap: Record<string, string> = {
        build: 'Build', plan: 'Plan', ask: 'Ask',
        debug: 'Debug', docs: 'Docs', code: 'Code', review: 'Review',
      };
      if (modeMap[cmdName]) {
        setMode(modeMap[cmdName]);
        if (rest) {
          postMessage({ type: 'sendMessage', payload: { prompt: rest, model, mode: modeMap[cmdName], context } });
          return;
        }
        setBusy(false);
        return;
      }
    }
    postMessage({ type: 'sendMessage', payload: { prompt, model, mode, context } });
  }, [model, mode, skills, setBusy, setContextEvents, setMode]);

  const handleOpenDiff = useCallback((filePath: string) => {
    postMessage({ type: 'openDiff', payload: { filePath } });
  }, []);

  const handleAbort = useCallback(() => {
    postMessage({ type: 'abort' });
    setBusy(false);
  }, [setBusy]);

  const handleRevert = useCallback((messageId: string) => {
    pendingRevertRef.current = messageId;
    setConfirmDialog({
      message: 'Revert to this message? This will undo all file changes made after it.',
      onConfirm: () => {
        const id = pendingRevertRef.current;
        pendingRevertRef.current = null;
        if (id) postMessage({ type: 'revertMessage', payload: { messageId: id } });
      },
    });
  }, [setConfirmDialog]);

  const handleUnrevert = useCallback(() => {
    postMessage({ type: 'unrevert' });
  }, []);

  const handleSlashCommand = useCallback((cmd: CommandItem) => {
    if (cmd.command === 'init' || cmd.command === 'review') {
      postMessage({ type: 'runCommand', payload: { command: cmd.command, args: '' } });
    } else if (cmd.agent) {
      const modeMap: Record<string, string> = {
        build: 'Build', plan: 'Plan', ask: 'Ask',
        debug: 'Debug', docs: 'Docs', code: 'Code', review: 'Review',
      };
      if (modeMap[cmd.agent]) {
        setMode(modeMap[cmd.agent]);
      }
    }
  }, [setMode]);

  const handleRespondPermission = useCallback(
    (permId: string, permSessionId: string, response: 'allow' | 'deny', remember?: boolean) => {
      postMessage({ type: 'respondPermission', payload: { permId, permSessionId, response, remember } });
    }, []);

  const handleRespondReadPermission = useCallback(
    (response: 'allow' | 'deny', remember?: boolean) => {
      if (!readPermissionPrompt) return;
      postMessage({ type: 'respondReadPermission', payload: { filePath: readPermissionPrompt.filePath, response, remember } });
      setReadPermissionPrompt(null);
    }, [readPermissionPrompt, setReadPermissionPrompt]);

  const handleLoadSession = useCallback((sessionId: string) => {
    setMessages([]);
    setShowSessions(false);
    postMessage({ type: 'loadSession', payload: { sessionId } });
  }, [setMessages, setShowSessions]);

  const showWelcome = messages.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#1e1e2e', position: 'relative' }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {showWelcome ? (
          <WelcomeScreen projectPath={gitInfo.projectPath} branch={gitInfo.branch} lastCommitTime={gitInfo.lastCommitTime} />
        ) : (
          <div style={{ flex: 1, padding: '16px 12px' }}>
            <ChatContainer messages={messages} onRevert={handleRevert} revertActive={revertActive} onUnrevert={handleUnrevert} contextEvents={contextEvents} onLoadSession={handleLoadSession} onRespondPermission={handleRespondPermission} onOpenDiff={handleOpenDiff} />
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {busy && (
        <div style={{ padding: '8px 16px', fontSize: 12, color: '#89b4fa', backgroundColor: '#181825', textAlign: 'center', borderTop: '1px solid #313244' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: '#89b4fa', marginRight: 8, animation: 'pulse 1s infinite', verticalAlign: 'middle' }} />
          Processing...
          <button onClick={handleAbort} style={{ marginLeft: 12, padding: '2px 8px', borderRadius: 4, border: '1px solid #45475a', backgroundColor: 'transparent', color: '#f38ba8', cursor: 'pointer', fontSize: 11 }}>Abort</button>
        </div>
      )}

      <div>
        <BottomInput
          onSend={handleSend}
          disabled={busy}
          onSearchFiles={(query) => postMessage({ type: 'searchFiles', payload: { query } })}
          fileSearchResults={fileSearchResults}
          fileSearchQuery={fileSearchQuery}
          onSlashCommand={handleSlashCommand}
          skills={skills}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 12px', backgroundColor: '#181825', borderTop: '1px solid #313244' }}>
          <ModeSelector mode={mode} onChange={setMode} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setShowSessions(true)}
              style={{
                backgroundColor: 'transparent', border: 'none', color: '#585b70',
                cursor: 'pointer', padding: 4, borderRadius: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#cdd6f4')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#585b70')}
              title="Session History"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            {providersLoaded ? (
              <ModelSelector model={model} onChange={setModel} availableModels={availableModels.filter(m => !hiddenModels[m.id])} />
            ) : (
              <span style={{ fontSize: 11, color: '#585b70', padding: '4px 8px' }}>Loading...</span>
            )}
            <button
              onClick={() => setShowProviders(true)}
              style={{
                backgroundColor: 'transparent', border: 'none',
                color: showProviders ? '#89b4fa' : '#585b70',
                cursor: 'pointer', padding: 4, borderRadius: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#cdd6f4')}
              onMouseLeave={(e) => (e.currentTarget.style.color = showProviders ? '#89b4fa' : '#585b70')}
              title="Provider Settings"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {showProviders && (
        <ProviderPopup
          onClose={() => { setShowProviders(false); postMessage({ type: 'listProviders' }); }}
          onModelSelect={(providerId, modelId) => { setModel(`${providerId}/${modelId}`); setShowProviders(false); }}
          availableModels={availableModels}
          hiddenModels={hiddenModels}
          onToggleModel={toggleModelVisibility}
          onToggleAllModels={handleToggleAllModels}
        />
      )}

      {showSessions && (
        <SessionListPopup
          onClose={() => setShowSessions(false)}
          onSelect={handleLoadSession}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {readPermissionPrompt && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: '#1e1e2e', border: '1px solid #45475a',
            borderRadius: 12, padding: 24, maxWidth: 400, width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#f38ba8', marginBottom: 8 }}>
              Read Permission Required
            </div>
            <div style={{ fontSize: 12, color: '#cdd6f4', marginBottom: 4 }}>
              The AI wants to read this file:
            </div>
            <div style={{
              fontSize: 13, color: '#89b4fa', fontFamily: 'monospace',
              padding: '8px 12px', backgroundColor: '#11111b',
              borderRadius: 6, marginBottom: 8, wordBreak: 'break-all',
            }}>
              {readPermissionPrompt.filePath}
            </div>
            <div style={{ fontSize: 11, color: '#a6adc8', marginBottom: 16 }}>
              {readPermissionPrompt.reason}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => handleRespondReadPermission('deny')} style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid #45475a',
                backgroundColor: 'transparent', color: '#cdd6f4', cursor: 'pointer', fontSize: 12,
              }}>Deny</button>
              <button onClick={() => handleRespondReadPermission('allow')} style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                backgroundColor: '#a6e3a1', color: '#11111b', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>Allow Once</button>
              <button onClick={() => handleRespondReadPermission('allow', true)} style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                backgroundColor: '#89b4fa', color: '#11111b', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>Always Allow</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
