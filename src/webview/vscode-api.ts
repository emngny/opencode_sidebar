import { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../extension/types';

declare function acquireVsCodeApi(): any;
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : (globalThis as any).vscode;

export function postMessage(msg: WebviewToExtensionMessage) {
  vscode.postMessage(msg);
}

export function onMessage(handler: (msg: ExtensionToWebviewMessage) => void): () => void {
  const wrapped = (event: MessageEvent) => {
    console.log('[webview] Received message from extension:', event.data.type);
    handler(event.data);
  };
  window.addEventListener('message', wrapped);
  return () => {
    window.removeEventListener('message', wrapped);
  };
}
