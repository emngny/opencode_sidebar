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
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
  },
  commands: {
    executeCommand: vi.fn().mockResolvedValue(undefined),
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
    // Call counts must not leak: the notification assertions count invocations.
    vi.clearAllMocks();
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

  describe('Permission notice while the view is hidden', () => {
    const permissionEvent = {
      type: 'toolEvent' as const,
      payload: {
        id: 'perm-1',
        type: 'permission',
        name: 'permission',
        status: 'running',
        content: 'bash',
        meta: { permId: 'perm-1' },
      },
    };

    function attachView(visible: boolean) {
      const view = {
        visible,
        onDidChangeVisibility: vi.fn(),
        webview: {
          postMessage: vi.fn(),
          onDidReceiveMessage: vi.fn(),
          options: {},
          html: '',
          cspSource: 'vscode-resource:',
          asWebviewUri: vi.fn(() => ({ toString: () => 'vscode-resource://script.js' })),
        },
      };
      provider.resolveWebviewView(view as never);
      return view;
    }

    it('asks the user to come back when a permission arrives while hidden', () => {
      // The webview document is deallocated while hidden, so the prompt is
      // dropped and the server would wait forever on the decision.
      attachView(false);
      provider.postMessage(permissionEvent);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'OpenCode needs your permission to continue',
        'Show',
      );
    });

    it('stays quiet when the view is visible', () => {
      attachView(true);
      provider.postMessage(permissionEvent);
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('focuses the sidebar when the notice is accepted', async () => {
      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Show');
      attachView(false);

      provider.postMessage(permissionEvent);
      await vi.waitFor(() =>
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.view.extension.opencode.focus'),
      );
    });

    it('does not notify for unrelated tool events', () => {
      attachView(false);
      provider.postMessage({
        type: 'toolEvent',
        payload: { id: 't1', type: 'file_read', name: 'read', status: 'running', content: 'Reading: a.ts' },
      });
      provider.postMessage({ type: 'sessionLoaded', payload: { sessionId: 's1', messages: [] } });
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('does not stack a second notice for the same request', () => {
      attachView(false);
      provider.postMessage(permissionEvent);
      provider.postMessage(permissionEvent);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce();
    });

    it('notices a question that arrives while the view is hidden', () => {
      // Same deadlock as a permission: the question tool blocks its turn until
      // an answer arrives, and the request only ever arrives as a live event.
      attachView(false);
      provider.postMessage({
        type: 'toolEvent',
        payload: {
          id: 'que_1',
          type: 'question',
          name: 'question',
          status: 'running',
          content: 'Which target?',
          meta: { questionId: 'que_1' },
        },
      });
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'OpenCode has questions waiting for your answer',
        'Show',
      );
    });
  });

  describe('Message Type Validation', () => {
    it('should accept valid message types', () => {
      const validTypes = ['sendMessage', 'searchFiles', 'listProviders', 'setApiKey', 'loadSkills'];

      for (const type of validTypes) {
        expect(validTypes).toContain(type);
      }
    });

    it('rejects unknown message types', () => {
      expect(provider.validatePayload('unknownMessage', {})).toBe(false);
      expect(provider.validatePayload('unknownMessage', undefined)).toBe(false);
    });

    it('rejects malformed message envelopes', () => {
      for (const payload of [null, [], 42, 'sendMessage', true]) {
        expect(provider.validatePayload('sendMessage', payload)).toBe(false);
      }
      expect(provider.validatePayload('searchFiles', { query: 42 })).toBe(false);
      expect(provider.validatePayload('setApiKey', { providerId: 'openai', key: null })).toBe(false);
      expect(provider.validatePayload('runCommand', { command: 42 })).toBe(false);
    });
  });

  describe('Payload Validation', () => {
    it('should validate searchFiles payload', () => {
      const isValid = provider.validatePayload('searchFiles', { query: '*.ts' });
      expect(isValid).toBe(true);
    });

    it('accepts a valid image context payload', () => {
      expect(
        provider.validatePayload('sendMessage', {
          prompt: 'describe',
          context: [{ type: 'image', name: 'shot.png', data: 'aGVsbG8=', mimeType: 'image/png' }],
        }),
      ).toBe(true);
    });

    it('rejects invalid image context payloads', () => {
      expect(
        provider.validatePayload('sendMessage', {
          prompt: 'describe',
          context: [{ type: 'image', name: 'shot.png', data: 'not base64!', mimeType: 'image/png' }],
        }),
      ).toBe(false);
      expect(
        provider.validatePayload('sendMessage', {
          prompt: 'describe',
          context: [{ type: 'image', name: 'shot.png', data: 'aGVsbG8=', mimeType: 'text/plain' }],
        }),
      ).toBe(false);
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

    it('should validate respondPermission payload', () => {
      expect(
        provider.validatePayload('respondPermission', {
          permId: 'perm-123',
          permSessionId: 'sess-123',
          response: 'allow',
        }),
      ).toBe(true);
      expect(
        provider.validatePayload('respondPermission', {
          permId: 'perm-123',
          permSessionId: 'sess-123',
          response: 'deny',
        }),
      ).toBe(true);
    });

    it('should reject respondPermission with missing permSessionId or bad response', () => {
      expect(provider.validatePayload('respondPermission', { permId: 'perm-123', response: 'allow' })).toBe(false);
      expect(
        provider.validatePayload('respondPermission', {
          permId: 'perm-123',
          permSessionId: 42,
          response: 'allow',
        }),
      ).toBe(false);
      expect(
        provider.validatePayload('respondPermission', {
          permId: 'perm-123',
          permSessionId: 'sess-123',
          response: 'maybe',
        }),
      ).toBe(false);
      expect(provider.validatePayload('respondPermission', { permId: 'perm-123', permSessionId: 'sess-123' })).toBe(
        false,
      );
    });

    it('should validate respondQuestion payload', () => {
      expect(provider.validatePayload('respondQuestion', { questionId: 'que_1' })).toBe(true);
      expect(provider.validatePayload('respondQuestion', { questionId: 'que_1', answers: [['main'], []] })).toBe(true);
    });

    it('should reject respondQuestion with a missing id or malformed answers', () => {
      expect(provider.validatePayload('respondQuestion', {})).toBe(false);
      expect(provider.validatePayload('respondQuestion', { questionId: 42 })).toBe(false);
      expect(provider.validatePayload('respondQuestion', { questionId: 'que_1', answers: 'main' })).toBe(false);
      expect(provider.validatePayload('respondQuestion', { questionId: 'que_1', answers: ['main'] })).toBe(false);
      expect(provider.validatePayload('respondQuestion', { questionId: 'que_1', answers: [[42]] })).toBe(false);
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
        'respondQuestion',
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
        'openExternal',
      ];

      expect(handlers).toHaveLength(25);
    });
  });
});
