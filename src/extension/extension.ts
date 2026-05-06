import * as vscode from 'vscode';
import { SidebarProvider } from './providers/SidebarProvider';
import { PreviewProvider } from './providers/PreviewProvider';
import { ReviewQueue } from './services/ReviewQueue';
import { registerAcceptChange } from './commands/acceptChange';
import { registerRejectChange } from './commands/rejectChange';

let sidebarProvider: SidebarProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  const previewProvider = new PreviewProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('opencode-preview', previewProvider),
  );

  const reviewQueue = new ReviewQueue(previewProvider);

  sidebarProvider = new SidebarProvider(context.extensionUri, reviewQueue, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider),
  );

  reviewQueue.setPostMessageCallback((msg) => sidebarProvider!.postMessage(msg));

  registerAcceptChange(context, reviewQueue);
  registerRejectChange(context, reviewQueue);

  const runCommand = vscode.commands.registerCommand('opencode.run', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor found.');
      return;
    }
    await reviewQueue.addReview(editor.document);
  });

  context.subscriptions.push(runCommand);
}

export function deactivate() {
  sidebarProvider?.dispose();
}
