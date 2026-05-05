import * as vscode from 'vscode';
import { PreviewProvider } from '../providers/PreviewProvider';
import { calculateDiffStats } from './DiffStats';
import { ExtensionToWebviewMessage, ReviewItem } from '../types';

export function extractCodeBlocks(text: string): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ language: match[1] || 'text', code: match[2] });
  }
  return blocks;
}

export class ReviewQueue {
  private queue: ReviewItem[] = [];
  private activeReview: ReviewItem | null = null;
  private postMessage?: (msg: ExtensionToWebviewMessage) => void;

  constructor(private previewProvider: PreviewProvider) {}

  setPostMessageCallback(cb: (msg: ExtensionToWebviewMessage) => void) {
    this.postMessage = cb;
  }

  async addReview(document: vscode.TextDocument, aiResponse?: string) {
    // Protect extension files from being edited
    const extensionPath = vscode.extensions.getExtension('undefined_publisher.opencode')?.extensionPath;
    if (extensionPath && document.uri.fsPath.startsWith(extensionPath)) {
      console.warn('[opencode] Blocked attempt to edit extension file:', document.uri.fsPath);
      return;
    }

    const originalContent = document.getText();
    let suggestedContent: string;

    if (aiResponse) {
      const codeBlocks = extractCodeBlocks(aiResponse);
      if (codeBlocks.length > 0) {
        // Use the first code block as the suggested change
        suggestedContent = codeBlocks[0].code;
      } else {
        // If no code blocks, don't create a review for conversational text
        console.log('[opencode] No code blocks found in AI response, skipping review');
        return;
      }
    } else {
      const { generateMockChange } = await import('./MockOpencode.js');
      suggestedContent = generateMockChange(originalContent);
    }

    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const previewUri = vscode.Uri.parse(`opencode-preview://review/${id}`).with({
      query: `path=${encodeURIComponent(document.uri.toString())}`,
    });

    this.previewProvider.setContent(previewUri, suggestedContent);

    const stats = calculateDiffStats(originalContent, suggestedContent);

    const review: ReviewItem = {
      id,
      originalUri: document.uri.toString(),
      previewUri: previewUri.toString(),
      filename: vscode.workspace.asRelativePath(document.uri),
      inserts: stats.inserts,
      deletes: stats.deletes,
    };

    this.queue.push(review);

    if (!this.activeReview) {
      await this.processNext();
    }
  }

  private async processNext() {
    if (this.queue.length === 0) {
      this.activeReview = null;
      await vscode.commands.executeCommand('setContext', 'opencode.hasActiveReview', false);
      this.postMessage?.({ type: 'reviewResolved', payload: { accepted: false } });
      return;
    }

    this.activeReview = this.queue.shift()!;
    const review = this.activeReview;

    await vscode.commands.executeCommand('setContext', 'opencode.hasActiveReview', true);

    const originalUri = vscode.Uri.parse(review.originalUri);
    const previewUri = vscode.Uri.parse(review.previewUri);

    await vscode.commands.executeCommand('vscode.diff', originalUri, previewUri, `Opencode Review: ${review.filename}`);

    this.postMessage?.({
      type: 'reviewReady',
      payload: {
        filename: review.filename,
        inserts: review.inserts,
        deletes: review.deletes,
      },
    });
  }

  getActiveReview(): ReviewItem | null {
    return this.activeReview;
  }

  async acceptActive() {
    if (!this.activeReview) return;
    const review = this.activeReview;

    const originalUri = vscode.Uri.parse(review.originalUri);
    const previewUri = vscode.Uri.parse(review.previewUri);

    const previewDoc = await vscode.workspace.openTextDocument(previewUri);
    const newContent = previewDoc.getText();

    const doc = await vscode.workspace.openTextDocument(originalUri);
    const lastLine = doc.lineCount > 0 ? doc.lineCount - 1 : 0;
    const lastChar = doc.lineCount > 0 ? doc.lineAt(lastLine).text.length : 0;
    const range = new vscode.Range(0, 0, lastLine, lastChar);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(originalUri, range, newContent);
    await vscode.workspace.applyEdit(edit);
    await vscode.workspace.saveAll(false);

    await this.closeDiffEditor(previewUri);
    await this.processNext();
  }

  async rejectActive() {
    if (!this.activeReview) return;
    const review = this.activeReview;
    const previewUri = vscode.Uri.parse(review.previewUri);

    await this.closeDiffEditor(previewUri);
    await this.processNext();
  }

  private async closeDiffEditor(previewUri: vscode.Uri) {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as any;
        if (
          input &&
          typeof input === 'object' &&
          (input.modified?.toString?.() === previewUri.toString() ||
            input.original?.toString?.() === previewUri.toString())
        ) {
          await vscode.window.tabGroups.close(tab);
          return;
        }
      }
    }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  }
}
