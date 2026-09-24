import * as vscode from 'vscode';
import type { ContextPart, ExtensionToWebviewMessage } from '../../shared/types';
import type { PermissionService } from './PermissionService';
import { resolveWorkspacePath } from '../utils/workspacePath';

export interface ProcessedContext {
  userContent: string;
  extraParts: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}

const MAX_CONTEXT_FILE_BYTES = 1024 * 1024;
const MAX_CONTEXT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CONTEXT_IMAGES = 5;
const MAX_CONTEXT_EXTRA_PARTS = 100;

function validateImageAttachment(item: Extract<ContextPart, { type: 'image' }>): string | null {
  if (!item.mimeType.startsWith('image/') || item.mimeType.length === 'image/'.length) {
    return 'Invalid image MIME type';
  }
  if (!item.data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)) {
    return 'Invalid base64 image data';
  }
  let padding = 0;
  if (item.data.endsWith('==')) padding = 2;
  else if (item.data.endsWith('=')) padding = 1;
  const decodedBytes = Math.floor((item.data.length * 3) / 4) - padding;
  if (decodedBytes > MAX_CONTEXT_IMAGE_BYTES) return 'Image exceeds 10 MB context limit';
  return null;
}

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
    let imageCount = 0;
    for (const item of context) {
      if (item.type === 'image') {
        imageCount++;
        const error = imageCount > MAX_CONTEXT_IMAGES ? 'Too many images (maximum 5)' : validateImageAttachment(item);
        if (error) {
          this._postMessage({
            type: 'toolEvent',
            payload: {
              id: `image_context_${Date.now()}`,
              type: 'file_read',
              name: 'image',
              status: 'failed',
              content: `Image skipped: ${error}`,
              meta: { name: item.name, error },
            },
          });
          continue;
        }
        if (extraParts.length < MAX_CONTEXT_EXTRA_PARTS) {
          extraParts.push({ type: 'image', data: item.data, mimeType: item.mimeType });
        }
        continue;
      }
      if (item.type !== 'file' || !folder) continue;
      const filePath = item.path;
      const resolved = resolveWorkspacePath(folder.uri.fsPath, filePath);
      if (!resolved.ok) {
        userContent += `\n\n[Skipped: ${filePath} — outside workspace]`;
        this._postMessage({
          type: 'toolEvent',
          payload: {
            id: `file_read_${filePath}`,
            type: 'file_read',
            name: 'read',
            status: 'failed',
            content: `Read denied: ${filePath}`,
            meta: { path: filePath, error: 'Path outside workspace' },
          },
        });
        continue;
      }

      const { allowed, deniedPattern } = this._permissions.isReadAllowed(resolved.relativePath);
      if (!allowed && deniedPattern) {
        this._postMessage({
          type: 'readFilePrompt',
          payload: {
            filePath,
            reason: `Matches deny pattern: ${deniedPattern}`,
            requestId: `${filePath}_${Date.now()}`,
          },
        });
        if (!(await this._permissions.waitForReadPermission(filePath))) {
          userContent += `\n\n[Skipped: ${filePath} — read denied by pattern]`;
          this._postMessage({
            type: 'toolEvent',
            payload: {
              id: `file_read_${filePath}`,
              type: 'file_read',
              name: 'read',
              status: 'failed',
              content: `Read denied: ${filePath}`,
              meta: { path: filePath, error: 'Permission denied' },
            },
          });
          continue;
        }
      }

      try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(resolved.resolvedPath));
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
