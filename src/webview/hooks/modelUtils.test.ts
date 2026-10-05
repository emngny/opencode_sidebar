import { describe, expect, it } from 'vitest';
import { buildModelItems, pickAutoSelectModel, resolvePromptModel, hasUnresolvablePin } from './modelUtils';

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
  /**
   * Sending the picker's model always overrode the agent's pin, because the
   * picker won whenever the agent was the active one. The model is now left off
   * the request whenever the pin can actually resolve, which is the normal case.
   */
  it('sends no model when the pin resolves and the user picked none', () => {
    expect(resolvePromptModel(true, false, 'opencode/mimo-v2.6-flash-free')).toBe('');
  });

  it('sends the picked model when the user chose one', () => {
    expect(resolvePromptModel(true, true, 'omniroute/pro-models')).toBe('omniroute/pro-models');
  });

  /**
   * Sisyphus is pinned to `opencode-go/normal-combo`, which this server does not
   * publish, so trusting the pin made every turn fail with `Model not found`.
   * There is nothing to defer to, so the picker is sent instead.
   */
  it('falls back to the picked model when the pin cannot resolve', () => {
    expect(resolvePromptModel(false, false, 'omniroute/pro-models')).toBe('omniroute/pro-models');
  });

  it('sends nothing rather than an empty pick', () => {
    expect(resolvePromptModel(true, true, '')).toBe('');
    expect(resolvePromptModel(false, false, '')).toBe('');
  });
});

describe('hasUnresolvablePin', () => {
  const models = [
    { id: 'omniroute/pro-models', name: 'Pro', providerId: 'omniroute' },
    { id: 'omniroute/normal-combo', name: 'Normal', providerId: 'omniroute' },
  ];

  it('passes a pin the catalog contains', () => {
    expect(hasUnresolvablePin('Prometheus', { Prometheus: 'omniroute/pro-models' }, models)).toBeNull();
  });

  it('reports a pin the catalog does not contain', () => {
    // Sisyphus pins `opencode-go/normal-combo` while the model is published as
    // `omniroute/normal-combo`, so every turn fails with "Model not found".
    expect(hasUnresolvablePin('Sisyphus', { Sisyphus: 'opencode-go/normal-combo' }, models)).toBe(
      'opencode-go/normal-combo',
    );
  });

  it('reports nothing for an agent that pins no model', () => {
    expect(hasUnresolvablePin('Sisyphus', {}, models)).toBeNull();
  });

  it('says nothing before the catalog arrives', () => {
    expect(hasUnresolvablePin('Sisyphus', { Sisyphus: 'opencode-go/normal-combo' }, [])).toBeNull();
  });
});
