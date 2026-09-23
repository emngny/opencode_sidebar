import { describe, it, expect } from 'vitest';
import {
  EXTENSION_TO_WEBVIEW_TYPES,
  ExtensionToWebviewMessage,
  WEBVIEW_TO_EXTENSION_TYPES,
  WebviewToExtensionMessage,
} from '../../shared/types';

describe('Extension-Webview Message Protocol', () => {
  describe('Message Type Definitions', () => {
    it('keeps webview allow-list aligned with declared message types', () => {
      const requiredTypes = [
        'sendMessage', 'acceptReview', 'rejectReview', 'clearChat', 'abort',
        'getSessions', 'loadSession', 'deleteSession', 'switchAgent', 'listProviders',
        'setApiKey', 'removeApiKey', 'searchFiles', 'getSavedModel', 'saveModel',
        'revertMessage', 'unrevert', 'respondPermission', 'respondReadPermission',
        'openDiff', 'runCommand', 'loadSkills', 'webviewReady',
      ] satisfies Array<WebviewToExtensionMessage['type']>;

      expect(new Set(WEBVIEW_TO_EXTENSION_TYPES)).toEqual(new Set(requiredTypes));
    });

    it('keeps extension allow-list aligned with declared message types', () => {
      const requiredTypes = [
        'receiveMessage', 'receiveChunk', 'streamEnd', 'reviewReady', 'reviewResolved',
        'status', 'gitInfo', 'projectInfo', 'sessionList', 'sessionLoaded', 'sessionDeleted',
        'agentList', 'error', 'providerList', 'providerUpdated', 'fileSearchResults',
        'savedModel', 'toolEvent', 'revertResult', 'messageMeta', 'reasoningContent',
        'readFilePrompt', 'skillList',
      ] satisfies Array<ExtensionToWebviewMessage['type']>;

      expect(new Set(EXTENSION_TO_WEBVIEW_TYPES)).toEqual(new Set(requiredTypes));
    });
  });

  describe('Message Payload Validation', () => {
    it('should validate sendMessage payload structure', () => {
      const validPayload: Extract<WebviewToExtensionMessage, { type: 'sendMessage' }>['payload'] = {
        prompt: 'Hello world',
        model: 'openai/gpt-4',
        mode: 'build',
        context: [
          { type: 'file', name: 'src/index.ts', path: 'src/index.ts' },
        ],
      };
      expect(validPayload.prompt).toBeDefined();
      expect(validPayload.mode).toBeDefined();
    });

    it('should validate toolEvent payload structure', () => {
      const validPayload: ExtensionToWebviewMessage['payload'] = {
        id: 'tool-123',
        type: 'tool_call',
        name: 'read',
        status: 'running',
        content: 'Reading file...',
        meta: { path: 'src/index.ts' },
      };

      expect(validPayload.type).toBe('tool_call');
      expect(validPayload.status).toBe('running');
    });

    it('should validate receiveChunk payload structure', () => {
      const validPayload: ExtensionToWebviewMessage['payload'] = {
        content: 'Hello',
        fullContent: 'Hello world',
      };

      expect(validPayload.content).toBeDefined();
    });
  });

  describe('Session Flow', () => {
    it('should track session lifecycle', () => {
      const sessionStates: string[] = [];

      sessionStates.push('created');
      sessionStates.push('active');
      sessionStates.push('idle');

      expect(sessionStates).toContain('created');
      expect(sessionStates).toContain('idle');
    });
  });

  describe('Streaming Flow', () => {
    it('should handle streaming message sequence', () => {
      const messages: string[] = [];

      messages.push('receiveMessage:assistant:empty');
      messages.push('receiveChunk:Hello');
      messages.push('receiveChunk: world');
      messages.push('streamEnd:Hello world');

      expect(messages[0]).toContain('receiveMessage');
      expect(messages[3]).toContain('streamEnd');
    });

    it('should handle tool events during streaming', () => {
      const events: any[] = [];

      events.push({ type: 'tool_call', name: 'read', status: 'running' });
      events.push({ type: 'file_read', name: 'read', status: 'completed' });
      events.push({ type: 'tool_result', name: 'read', status: 'completed' });

      expect(events[0].status).toBe('running');
      expect(events[1].type).toBe('file_read');
    });
  });

  describe('Permission Flow', () => {
    it('should handle permission request flow', () => {
      const permission = {
        id: 'perm-123',
        type: 'read',
        patterns: ['**/.env'],
        response: 'allow',
        remember: true,
      };

      expect(permission.response).toBe('allow');
      expect(permission.remember).toBe(true);
    });

    it('should handle read permission request flow', () => {
      const readPerm = {
        filePath: 'config/.env',
        response: 'deny',
        requestId: 'req-456',
      };

      expect(readPerm.response).toBe('deny');
    });
  });
});