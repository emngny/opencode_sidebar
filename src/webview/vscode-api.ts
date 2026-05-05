import { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../extension/types';

const vscode = (window as any).acquireVsCodeApi();

export function postMessage(msg: WebviewToExtensionMessage) {
  vscode.postMessage(msg);
}

export function onMessage(handler: (msg: ExtensionToWebviewMessage) => void): () => void {
  const wrapped = (event: MessageEvent) => {
    handler(event.data);
  };
  window.addEventListener('message', wrapped);
  return () => {
    window.removeEventListener('message', wrapped);
  };
}
