import { describe, expect, it } from 'vitest';
import { filterChatModeAgents, mapAgentSummaries } from './types';

describe('mapAgentSummaries', () => {
  it('keeps the id and mode reported by GET /agent', () => {
    expect(
      mapAgentSummaries([
        { name: 'plan', mode: 'subagent' },
        { name: 'Prometheus - Plan Builder', mode: 'primary' },
      ]),
    ).toEqual([
      { id: 'plan', mode: 'subagent' },
      { id: 'Prometheus - Plan Builder', mode: 'primary' },
    ]);
  });

  it('accepts bare string agents', () => {
    expect(mapAgentSummaries(['build'])).toEqual([{ id: 'build', mode: undefined, model: undefined }]);
  });

  it('reads the model an agent pins', () => {
    expect(
      mapAgentSummaries([
        {
          name: 'Prometheus - Plan Builder',
          mode: 'primary',
          model: { providerID: 'omniroute', modelID: 'pro-models' },
        },
        { name: 'build', mode: 'primary', model: undefined },
      ]),
    ).toEqual([
      { id: 'Prometheus - Plan Builder', mode: 'primary', model: 'omniroute/pro-models' },
      { id: 'build', mode: 'primary', model: undefined },
    ]);
  });

  it('drops entries without an id', () => {
    expect(mapAgentSummaries([{ mode: 'primary' }, {}])).toEqual([]);
  });
});

describe('filterChatModeAgents', () => {
  it('keeps session-owning agents and drops subagent-only ones', () => {
    expect(
      filterChatModeAgents([
        { id: 'build', mode: 'primary' },
        { id: 'flex', mode: 'all' },
        { id: 'plan', mode: 'subagent' },
        { id: 'oracle', mode: 'subagent' },
      ]),
    ).toEqual([
      { id: 'build', mode: 'primary' },
      { id: 'flex', mode: 'all' },
    ]);
  });

  it('drops internal opencode agents even though they are primary', () => {
    expect(
      filterChatModeAgents([
        { id: 'code', mode: 'primary' },
        { id: 'compaction', mode: 'primary' },
        { id: 'summary', mode: 'primary' },
        { id: 'title', mode: 'primary' },
      ]),
    ).toEqual([{ id: 'code', mode: 'primary' }]);
  });

  it('keeps agents when the server omits the mode', () => {
    expect(filterChatModeAgents([{ id: 'build' }])).toEqual([{ id: 'build' }]);
  });
});
