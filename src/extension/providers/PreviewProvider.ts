import * as vscode from 'vscode';

export class PreviewProvider implements vscode.TextDocumentContentProvider {
  private _documents = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  setContent(uri: vscode.Uri, content: string) {
    this._documents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this._documents.get(uri.toString()) ?? '';
  }

  getContent(uri: vscode.Uri): string | undefined {
    return this._documents.get(uri.toString());
  }
}
