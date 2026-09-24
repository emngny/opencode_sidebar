import { describe, expect, it } from 'vitest';
import { buildModelItems, pickAutoSelectModel, resolvePromptModel } from './modelUtils';

describe('buildModelItems', () => {
  it('includes only connected provider models and formats IDs', () => {
    const result = {
      connected: ['acme'],
      all: [
        { id: 'acme', models: { 'model-b': { name: 'Beta' }, 'model-a': { name: '' } } },
        { id: 'other', models: { hidden: { name: 'Hidden' } } },
      ],
    };

    expect(buildModelItems(result as any)).toEqual([
      { id: 'acme/model-b', name: 'Beta', providerId: 'acme' },
      { id: 'acme/model-a', name: 'model-a', providerId: 'acme' },
    ]);
  });

  it('sorts opencode providers before other providers', () => {
    const result = {
      connected: ['z-provider', 'opencode', 'opencode-go'],
      all: [
        { id: 'z-provider', models: { m: { name: 'Z' } } },
        { id: 'opencode', models: { m: { name: 'Z' } } },
        { id: 'opencode-go', models: { m: { name: 'A' } } },
      ],
    };

    expect(buildModelItems(result as any).map((model) => model.providerId)).toEqual([
      'opencode',
      'opencode-go',
      'z-provider',
    ]);
  });
});

describe('pickAutoSelectModel', () => {
  it('selects first visible model when no current model exists', () => {
    const models = [{ id: 'a/model', name: 'A', providerId: 'a' }];
    expect(pickAutoSelectModel(models, '', { 'a/model': true })).toBeNull();
    expect(pickAutoSelectModel(models, '', {})).toBe('a/model');
  });

  it('keeps an existing model that the server still offers', () => {
    const models = [
      { id: 'a/model', name: 'A', providerId: 'a' },
      { id: 'b/model', name: 'B', providerId: 'b' },
    ];
    expect(pickAutoSelectModel(models, 'b/model', {})).toBeNull();
  });

  it('replaces a saved model the server no longer offers', () => {
    const models = [{ id: 'a/model', name: 'A', providerId: 'a' }];
    expect(pickAutoSelectModel(models, 'a/removed-model', {})).toBe('a/model');
  });

  it('skips hidden models when replacing a stale selection', () => {
    const models = [
      { id: 'a/model', name: 'A', providerId: 'a' },
      { id: 'b/model', name: 'B', providerId: 'b' },
    ];
    expect(pickAutoSelectModel(models, 'gone/model', { 'a/model': true })).toBe('b/model');
  });
});

describe('resolvePromptModel', () => {
  const agentModels = { Prometheus: 'omniroute/pro-models' };

  it('uses the picker for the active mode so a manual change wins', () => {
    expect(resolvePromptModel('Prometheus', 'Prometheus', 'opencode/mimo', agentModels)).toBe('opencode/mimo');
  });

  it('uses the pinned model when switching to an agent that pins one', () => {
    expect(resolvePromptModel('Prometheus', 'build', 'opencode/mimo', agentModels)).toBe('omniroute/pro-models');
  });

  it('falls back to the picked model for agents without a pin', () => {
    expect(resolvePromptModel('build', 'prometheus', 'opencode/mimo', agentModels)).toBe('opencode/mimo');
  });

  it('stays empty when nothing is picked and no agent pins a model', () => {
    expect(resolvePromptModel('build', 'build', '', {})).toBe('');
  });
});
