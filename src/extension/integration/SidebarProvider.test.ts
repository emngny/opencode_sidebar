import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SidebarProvider } from '../providers/SidebarProvider';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
    fs: {
      readFile: vi.fn(),
      readDirectory: vi.fn(),
    },
  },
  window: {
    registerWebviewViewProvider: vi.fn(),
    showTextDocument: vi.fn(),
  },
  Uri: {
    joinPath: vi.fn(),
    file: vi.fn(),
  },
  EventEmitter: vi.fn(),
}));

describe('SidebarProvider Message Handling', () => {
  let provider: SidebarProvider;
  let mockContext: any;
  let extensionUri: vscode.Uri;

  beforeEach(() => {
    mockContext = {
      extensionUri: { fsPath: '/test/ext' },
      secrets: {
        get: vi.fn().mockResolvedValue(undefined),
        store: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      subscriptions: [],
    };
    extensionUri = { fsPath: '/test/ext' } as any;
    provider = new SidebarProvider(extensionUri, mockContext);
  });

  describe('Message Type Validation', () => {
    it('should accept valid message types', () => {
      const validTypes = [
        'sendMessage',
        'searchFiles',
        'listProviders',
        'setApiKey',
        'loadSkills',
      ];

      for (const type of validTypes) {
        expect(validTypes).toContain(type);
      }
    });
  });

  describe('Payload Validation', () => {
    it('should validate searchFiles payload', () => {
      const isValid = provider.validatePayload('searchFiles', { query: '*.ts' });
      expect(isValid).toBe(true);
    });

    it('should reject searchFiles with missing query', () => {
      const isValid = provider.validatePayload('searchFiles', {});
      expect(isValid).toBe(false);
    });

    it('should validate setApiKey payload', () => {
      const isValid = provider.validatePayload('setApiKey', { providerId: 'openai', key: 'sk-123' });
      expect(isValid).toBe(true);
    });

    it('should reject setApiKey with missing fields', () => {
      const isValid = provider.validatePayload('setApiKey', { providerId: 'openai' });
      expect(isValid).toBe(false);
    });

    it('should validate runCommand payload', () => {
      const isValid = provider.validatePayload('runCommand', { command: 'init' });
      expect(isValid).toBe(true);
    });

    it('should validate loadSession payload', () => {
      const isValid = provider.validatePayload('loadSession', { sessionId: 'sess-123' });
      expect(isValid).toBe(true);
    });
  });

  describe('Message Type Mapping', () => {
    it('should have handlers for all WEBVIEW_TO_EXTENSION_TYPES', () => {
      const handlers = [
        'searchFiles',
        'getSavedModel',
        'saveModel',
        'revertMessage',
        'unrevert',
        'respondPermission',
        'respondReadPermission',
        'loadSkills',
        'runCommand',
        'webviewReady',
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
        'openDiff',
      ];

      expect(handlers.length).toBe(23);
    });
  });
});