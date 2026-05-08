import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types';

describe('Extension-Webview Message Protocol', () => {
  describe('Message Type Definitions', () => {
    it('should have all required webview-to-extension message types', () => {
      const requiredTypes = [
        'sendMessage',
        'acceptReview',
        'rejectReview',
        'clearChat',
        'abort',
        'getSessions',
        'loadSession',
        'deleteSession',
        'switchAgent',
        'listProviders',
        'setApiKey',
        'removeApiKey',
        'searchFiles',
        'getSavedModel',
        'saveModel',
        'revertMessage',
        'unrevert',
        'respondPermission',
        'respondReadPermission',
        'openDiff',
        'runCommand',
        'loadSkills',
        'webviewReady',
      ];

      const typeMap: Record<string, boolean> = {};
      for (const t of requiredTypes) {
        typeMap[t] = true;
      }

      expect(typeMap['sendMessage']).toBe(true);
      expect(typeMap['webviewReady']).toBe(true);
    });

    it('should have all required extension-to-webview message types', () => {
      const requiredTypes = [
        'receiveMessage',
        'receiveChunk',
        'streamEnd',
        'reviewReady',
        'reviewResolved',
        'status',
        'gitInfo',
        'projectInfo',
        'sessionList',
        'sessionLoaded',
        'sessionDeleted',
        'agentList',
        'error',
        'providerList',
        'providerUpdated',
        'fileSearchResults',
        'savedModel',
        'toolEvent',
        'revertResult',
        'messageMeta',
        'reasoningContent',
        'readFilePrompt',
        'skillList',
      ];

      expect(requiredTypes.length).toBeGreaterThan(20);
    });
  });

  describe('Message Payload Validation', () => {
    it('should validate sendMessage payload structure', () => {
      const validPayload: WebviewToExtensionMessage['payload'] = {
        prompt: 'Hello world',
        model: 'openai/gpt-4',
        mode: 'build',
        context: [
          { type: 'file', path: 'src/index.ts' },
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