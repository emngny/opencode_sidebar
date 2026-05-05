import * as vscode from 'vscode';
import { ReviewQueue } from '../services/ReviewQueue';

export function registerAcceptChange(context: vscode.ExtensionContext, reviewQueue: ReviewQueue) {
  const disposable = vscode.commands.registerCommand('opencode.acceptChange', async () => {
    await reviewQueue.acceptActive();
  });
  context.subscriptions.push(disposable);
}
