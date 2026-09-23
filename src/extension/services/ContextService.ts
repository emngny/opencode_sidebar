import * as vscode from 'vscode';
import type { ContextPart, ExtensionToWebviewMessage } from '../../shared/types';
import type { PermissionService } from './PermissionService';

export interface ProcessedContext {
  userContent: string;
  extraParts: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}

const MAX_CONTEXT_FILE_BYTES = 1024 * 1024;
const MAX_CONTEXT_EXTRA_PARTS = 100;

export class ContextService {
  constructor(
    private readonly _permissions: PermissionService,
    private readonly _postMessage: (message: ExtensionToWebviewMessage) => void,
  ) {}

  async process(prompt: string, context: ContextPart[] | undefined): Promise<ProcessedContext> {
    let userContent = prompt;
    const extraParts: ProcessedContext['extraParts'] = [];
    if (!Array.isArray(context)) return { userContent, extraParts };

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return { userContent, extraParts };

    for (const item of context) {
      if (item.type !== 'file') continue;
      const filePath = item.path;
      const { allowed, deniedPattern } = this._permissions.isReadAllowed(filePath);
      if (!allowed && deniedPattern) {
        this._postMessage({
          type: 'readFilePrompt',
          payload: { filePath, reason: `Matches deny pattern: ${deniedPattern}`, requestId: `${filePath}_${Date.now()}` },
        });
        if (!(await this._permissions.waitForReadPermission(filePath))) {
          userContent += `\n\n[Skipped: ${filePath} — read denied by pattern]`;
          this._postMessage({
            type: 'toolEvent',
            payload: { id: `file_read_${filePath}`, type: 'file_read', name: 'read', status: 'failed', content: `Read denied: ${filePath}`, meta: { path: filePath, error: 'Permission denied' } },
          });
          continue;
        }
      }

      try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, filePath));
        if (content.byteLength > MAX_CONTEXT_FILE_BYTES) {
          userContent += `\n\n[Skipped: ${filePath} — exceeds 1 MB context limit]`;
          continue;
        }
        const containsNul = content.includes(0);
        if (containsNul) {
          userContent += `\n\n[Skipped: ${filePath} — binary file]`;
          continue;
        }
        userContent += `\n\n[File: ${filePath}]\n${new TextDecoder().decode(content)}`;
        if (extraParts.length < MAX_CONTEXT_EXTRA_PARTS) {
          extraParts.push({ type: 'text', text: `[Context file: ${filePath}]` });
        } else {
          userContent += `\n\n[Context file omitted: ${filePath} — extra part limit reached]`;
        }
      } catch {
        userContent += `\n\n[Could not read file: ${filePath}]`;
      }
    }
    return { userContent, extraParts };
  }
}
