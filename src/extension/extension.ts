import * as vscode from 'vscode';
import { SidebarProvider } from './providers/SidebarProvider';

let _sidebarProvider: SidebarProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  _sidebarProvider = new SidebarProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, _sidebarProvider),
  );
}

export function deactivate() {
  _sidebarProvider?.dispose();
  _sidebarProvider = undefined;
}
