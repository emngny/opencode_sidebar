import * as vscode from 'vscode';
import { SidebarProvider } from './providers/SidebarProvider';

let sidebarProvider: SidebarProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  sidebarProvider = new SidebarProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider),
  );
}

export function deactivate() {
  sidebarProvider?.dispose();
}
