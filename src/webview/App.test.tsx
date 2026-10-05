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

describe('App — the agent decides the model unless the user picked one', () => {
  beforeEach(() => {
    vi.mocked(postMessage).mockClear();
  });

  /**
   * The picker model used to be sent on every turn, which silently overrode the
   * active agent's pin. That is how `Prometheus - Plan Builder` — pinned to
   * `omniroute/pro-models` — ran `opencode/mimo-v2.6-flash-free`, a free-tier
   * model the provider then refused. Leaving the model off the request lets
   * opencode apply the pin it already knows.
   */
  it('sends no model when the pin resolves and the user chose none', () => {
    const state = modelState();
    state.mode = 'Prometheus - Plan Builder';
    state.agentModels = { 'Prometheus - Plan Builder': 'omniroute/pro-models' };
    // The catalog has to actually contain the pin, or it counts as unresolvable
    // and the picker is sent as a fallback.
    state.availableModels = [{ id: 'omniroute/pro-models', name: 'Pro', providerId: 'omniroute' }];
    vi.mocked(useModelManager).mockReturnValue(state as never);
    render(<App />);

    fireEvent.change(textbox(), { target: { value: 'hello' } });
    fireEvent.keyDown(textbox(), { key: 'Enter' });

    const sent = vi.mocked(postMessage).mock.calls.find((c) => c[0].type === 'sendMessage');
    expect(sent).toBeDefined();
    expect((sent?.[0] as { payload: { model?: string } }).payload.model).toBe('');
  });

  /**
   * Sisyphus is pinned to `opencode-go/normal-combo`, which this server does not
   * publish, so a request that trusted the pin died with `Model not found`. The
   * picker has to be sent instead — there is no working pin to defer to.
   */
  it('sends the picked model when the active pin cannot resolve', () => {
    const state = modelState();
    state.mode = 'Sisyphus - ultraworker';
    state.agentModels = { 'Sisyphus - ultraworker': 'opencode-go/normal-combo' };
    state.availableModels = [{ id: 'omniroute/normal-combo', name: 'Normal', providerId: 'omniroute' }];
    vi.mocked(useModelManager).mockReturnValue(state as never);
    render(<App />);

    fireEvent.change(textbox(), { target: { value: 'hello' } });
    fireEvent.keyDown(textbox(), { key: 'Enter' });

    const sent = vi.mocked(postMessage).mock.calls.find((c) => c[0].type === 'sendMessage');
    expect((sent?.[0] as { payload: { model?: string } }).payload.model).toBe('opencode/glm-5.1');
  });

  it('names the agent so opencode never falls back to its default one', () => {
    const state = modelState();
    state.mode = 'Prometheus - Plan Builder';
    vi.mocked(useModelManager).mockReturnValue(state as never);
    render(<App />);

    fireEvent.change(textbox(), { target: { value: 'hello' } });
    fireEvent.keyDown(textbox(), { key: 'Enter' });

    const sent = vi.mocked(postMessage).mock.calls.find((c) => c[0].type === 'sendMessage');
    expect((sent?.[0] as { payload: { mode?: string } }).payload.mode).toBe('Prometheus - Plan Builder');
  });

  it('sends the model the user picked in the picker', () => {
    const state = modelState();
    state.mode = 'Prometheus - Plan Builder';
    vi.mocked(useModelManager).mockReturnValue(state as never);
    render(<App />);

    // The user reaches for a model, which must outrank the agent's pin.
    fireEvent.click(screen.getByRole('button', { name: /model/i }));
    // The name shows twice — on the trigger and in the list — so the last is the row.
    const rows = screen.getAllByText('GLM 5.1');
    fireEvent.click(rows[rows.length - 1] as HTMLElement);

    fireEvent.change(textbox(), { target: { value: 'hello' } });
    fireEvent.keyDown(textbox(), { key: 'Enter' });

    const sent = vi.mocked(postMessage).mock.calls.find((c) => c[0].type === 'sendMessage');
    expect((sent?.[0] as { payload: { model?: string } }).payload.model).toBe('opencode/glm-5.1');
  });

  it('warns when the active agent pins a model the server does not have', () => {
    const state = modelState();
    state.mode = 'Sisyphus - ultraworker';
    // Sisyphus pins `opencode-go/normal-combo`; the catalog publishes it under
    // omniroute, so every turn would fail with "Model not found".
    state.agentModels = { 'Sisyphus - ultraworker': 'opencode-go/normal-combo' };
    state.availableModels = [{ id: 'omniroute/normal-combo', name: 'Normal', providerId: 'omniroute' }];
    vi.mocked(useModelManager).mockReturnValue(state as never);

    render(<App />);

    expect(screen.getByText(/opencode-go\/normal-combo/)).toBeTruthy();
  });

  it('does not warn when the pin resolves', () => {
    const state = modelState();
    state.mode = 'Prometheus - Plan Builder';
    state.agentModels = { 'Prometheus - Plan Builder': 'omniroute/pro-models' };
    state.availableModels = [{ id: 'omniroute/pro-models', name: 'Pro', providerId: 'omniroute' }];
    vi.mocked(useModelManager).mockReturnValue(state as never);

    render(<App />);

    expect(screen.queryByText(/is pinned to/)).toBeNull();
  });

  it('does not warn before the catalog arrives', () => {
    const state = modelState();
    state.mode = 'Sisyphus - ultraworker';
    state.agentModels = { 'Sisyphus - ultraworker': 'opencode-go/normal-combo' };
    state.availableModels = [];
    vi.mocked(useModelManager).mockReturnValue(state as never);

    render(<App />);

    expect(screen.queryByText(/is pinned to/)).toBeNull();
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
