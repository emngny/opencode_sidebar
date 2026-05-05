import * as vscode from 'vscode';
import { ReviewQueue } from '../services/ReviewQueue';

export function registerRejectChange(context: vscode.ExtensionContext, reviewQueue: ReviewQueue) {
  const disposable = vscode.commands.registerCommand('opencode.rejectChange', async () => {
    await reviewQueue.rejectActive();
  });
  context.subscriptions.push(disposable);
}
