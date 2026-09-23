import { describe, expect, it } from 'vitest';
import { buildModelItems, pickAutoSelectModel } from './modelUtils';

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

  it('does not replace an existing model', () => {
    expect(pickAutoSelectModel([{ id: 'a/model', name: 'A', providerId: 'a' }], 'current', {})).toBeNull();
  });
});
