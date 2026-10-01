// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPersistedState, setPersistedState } from '../vscode-api';
import { useModelManager } from './useModelManager';

vi.mock('../vscode-api', () => ({
  postMessage: vi.fn(),
  getPersistedState: vi.fn(() => ({})),
  setPersistedState: vi.fn(),
}));

/**
 * VS Code deallocates the webview document while the view is hidden and
 * recreates it on the next show, so the agent mode, the hidden-model list, and
 * the provider panel have to come back from the state VS Code persisted.
 */
describe('useModelManager persistence', () => {
  beforeEach(() => {
    vi.mocked(setPersistedState).mockClear();
    vi.mocked(getPersistedState).mockReturnValue({});
  });

  it('restores the agent mode chosen before the view was hidden', () => {
    vi.mocked(getPersistedState).mockReturnValue({ mode: 'review' });

    const { result } = renderHook(() => useModelManager());

    expect(result.current.mode).toBe('review');
  });

  /**
   * No default. `build` is a subagent on a machine where plugins own the
   * agents, so seeding it made the reconciler report a switch away from a mode
   * the server had never heard of. `App.tsx` adopts the server's first agent
   * once the list arrives.
   */
  it('starts with no mode when nothing was stored', () => {
    const { result } = renderHook(() => useModelManager());
    expect(result.current.mode).toBe('');
  });

  it('restores the hidden-model list', () => {
    vi.mocked(getPersistedState).mockReturnValue({ hiddenModels: { 'opencode/glm-5.1': true } });

    const { result } = renderHook(() => useModelManager());

    expect(result.current.hiddenModels).toEqual({ 'opencode/glm-5.1': true });
  });

  it('restores the provider panel state', () => {
    vi.mocked(getPersistedState).mockReturnValue({ showProviders: true });

    const { result } = renderHook(() => useModelManager());

    expect(result.current.showProviders).toBe(true);
  });

  it('writes the mode back after a change', () => {
    const { result } = renderHook(() => useModelManager());

    act(() => result.current.setMode('debug'));

    expect(setPersistedState).toHaveBeenCalledWith({ mode: 'debug' });
  });

  it('writes the hidden-model list back after a toggle', () => {
    const { result } = renderHook(() => useModelManager());

    act(() => result.current.toggleModelVisibility('opencode/glm-5.1'));

    expect(setPersistedState).toHaveBeenCalledWith({ hiddenModels: { 'opencode/glm-5.1': true } });
  });

  it('keeps the mirror ref in step for auto-selection', () => {
    // `pickAutoSelectModel` reads hiddenModelsRef, not the state, so a stale ref
    // would let a hidden model be re-selected after the view comes back.
    const { result } = renderHook(() => useModelManager());

    act(() => result.current.toggleModelVisibility('opencode/glm-5.1'));

    expect(result.current.hiddenModelsRef.current).toEqual({ 'opencode/glm-5.1': true });
  });

  it('leaves the model to the extension workspaceState', () => {
    // The model already round-trips through the extension's workspaceState, so
    // a second persistence layer here would be redundant.
    const { result } = renderHook(() => useModelManager());

    act(() => result.current.setModel('opencode/glm-5.1'));

    expect(setPersistedState).not.toHaveBeenCalledWith({ model: 'opencode/glm-5.1' });
  });
});
