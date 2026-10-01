// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import App from './App';
import { postMessage } from './vscode-api';
import { BUILTIN_COMMANDS } from './slashCommands';

vi.mock('./vscode-api', () => ({
  postMessage: vi.fn(),
  onMessage: vi.fn(() => () => undefined),
}));

vi.mock('./hooks/useMessageHandler', () => ({
  useMessageHandler: vi.fn(),
}));

vi.mock('./hooks/useModelManager', () => ({
  useModelManager: vi.fn(),
}));

const { useModelManager } = await import('./hooks/useModelManager');

function modelState() {
  return {
    model: 'opencode/glm-5.1',
    setModel: vi.fn(),
    mode: 'build',
    setMode: vi.fn(),
    gitInfo: { projectPath: 'c:/repo', branch: 'main', lastCommitTime: '2 hours ago' },
    setGitInfo: vi.fn(),
    availableModels: [{ id: 'opencode/glm-5.1', name: 'GLM 5.1', providerId: 'opencode' }],
    setAvailableModels: vi.fn(),
    agentModels: {},
    setAgentModels: vi.fn(),
    hiddenModels: {},
    setHiddenModels: vi.fn(),
    providersLoaded: true,
    setProvidersLoaded: vi.fn(),
    skills: [],
    setSkills: vi.fn(),
    fileSearchResults: [],
    setFileSearchResults: vi.fn(),
    fileSearchQuery: '',
    setFileSearchQuery: vi.fn(),
    revertActive: false,
    setRevertActive: vi.fn(),
    confirmDialog: null,
    setConfirmDialog: vi.fn(),
    readPermissionPrompt: null,
    setReadPermissionPrompt: vi.fn(),
    showProviders: false,
    setShowProviders: vi.fn(),
    showSessions: false,
    setShowSessions: vi.fn(),
    pendingRevertRef: { current: null },
    hiddenModelsRef: { current: {} },
    toggleModelVisibility: vi.fn(),
    handleToggleAllModels: vi.fn(),
    processProviderList: vi.fn(),
    tryAutoSelectModel: vi.fn(),
  };
}

function textbox(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/Ask something/) as HTMLTextAreaElement;
}

describe('App — New Chat button', () => {
  beforeEach(() => {
    vi.mocked(postMessage).mockClear();
    vi.mocked(useModelManager).mockReturnValue(modelState() as never);
  });

  it('renders a New Chat control in the bottom toolbar', () => {
    render(<App />);
    expect(screen.getByLabelText('New Chat')).toBeTruthy();
  });

  it('sits next to the session-history control', () => {
    render(<App />);
    expect(screen.getByLabelText('Session History')).toBeTruthy();
    expect(screen.getByLabelText('New Chat')).toBeTruthy();
  });

  it('posts clearChat when clicked', () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('New Chat'));
    expect(postMessage).toHaveBeenCalledWith({ type: 'clearChat' });
  });

  it('leaves revert mode', () => {
    const state = modelState();
    state.revertActive = true;
    vi.mocked(useModelManager).mockReturnValue(state as never);
    render(<App />);

    fireEvent.click(screen.getByLabelText('New Chat'));

    expect(state.setRevertActive).toHaveBeenCalledWith(false);
  });

  it('dismisses a pending read-permission prompt', () => {
    const state = modelState();
    state.readPermissionPrompt = { filePath: 'c:/repo/secret.txt', response: 'deny' } as never;
    vi.mocked(useModelManager).mockReturnValue(state as never);
    render(<App />);

    fireEvent.click(screen.getByLabelText('New Chat'));

    expect(state.setReadPermissionPrompt).toHaveBeenCalledWith(null);
  });

  it('closes the session-history popup', () => {
    const state = modelState();
    state.showSessions = true;
    vi.mocked(useModelManager).mockReturnValue(state as never);
    render(<App />);

    fireEvent.click(screen.getByLabelText('New Chat'));

    expect(state.setShowSessions).toHaveBeenCalledWith(false);
  });

  it('dismisses a pending revert confirmation', () => {
    const state = modelState();
    vi.mocked(useModelManager).mockReturnValue(state as never);
    render(<App />);

    fireEvent.click(screen.getByLabelText('New Chat'));

    expect(state.setConfirmDialog).toHaveBeenCalledWith(null);
  });

  it('keeps model, mode, skill and visibility selection', () => {
    const state = modelState();
    vi.mocked(useModelManager).mockReturnValue(state as never);
    render(<App />);

    fireEvent.click(screen.getByLabelText('New Chat'));

    expect(state.setModel).not.toHaveBeenCalled();
    expect(state.setMode).not.toHaveBeenCalled();
    expect(state.setHiddenModels).not.toHaveBeenCalled();
    expect(state.setSkills).not.toHaveBeenCalled();
  });
});

describe('App — /new slash command', () => {
  beforeEach(() => {
    vi.mocked(postMessage).mockClear();
    vi.mocked(useModelManager).mockReturnValue(modelState() as never);
  });

  it('is registered as an agent-less builtin command', () => {
    const newCmd = BUILTIN_COMMANDS.find((c) => c.command === 'new');
    expect(newCmd).toBeDefined();
    // `handleSlashCommand` routes agent-bearing commands to the agent picker, so
    // `new` must stay agent-less to be handled as a local action.
    expect(newCmd?.agent).toBeUndefined();
  });

  it('appears in the slash popup and posts clearChat, not runCommand', () => {
    render(<App />);

    fireEvent.change(textbox(), { target: { value: '/' } });
    // The popup renders `/<command>` then the description, concatenated with no
    // separator (`/newStart a fresh chat session`), and `label` is never shown.
    const option = screen.getAllByRole('option').find((el) => (el.textContent ?? '').startsWith('/new'));
    expect(option).toBeDefined();

    fireEvent.click(option as HTMLElement);

    expect(postMessage).toHaveBeenCalledWith({ type: 'clearChat' });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'runCommand', payload: expect.objectContaining({ command: 'new' }) }),
    );
  });
});
