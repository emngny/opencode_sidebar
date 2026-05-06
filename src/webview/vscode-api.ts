import { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../extension/types';

const VALID_EXTENSION_TYPES: readonly string[] = [
  'receiveMessage', 'receiveChunk', 'streamEnd', 'reviewReady', 'reviewResolved',
  'status', 'gitInfo', 'projectInfo', 'sessionList', 'sessionLoaded', 'sessionDeleted',
  'agentList', 'error', 'providerList', 'providerUpdated', 'fileSearchResults',
  'savedModel', 'toolEvent', 'revertResult', 'messageMeta', 'reasoningContent',
  'readFilePrompt', 'skillList',
];

declare function acquireVsCodeApi(): any;
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : (globalThis as any).vscode;

export function postMessage(msg: WebviewToExtensionMessage) {
  vscode.postMessage(msg);
}

export function onMessage(handler: (msg: ExtensionToWebviewMessage) => void): () => void {
  const wrapped = (event: MessageEvent) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || !VALID_EXTENSION_TYPES.includes(msg.type)) {
      console.warn('[webview] Ignored message with unknown type:', msg?.type);
      return;
    }
    console.log('[webview] Received message from extension:', msg.type);
    handler(msg);
  };
  window.addEventListener('message', wrapped);
  return () => {
    window.removeEventListener('message', wrapped);
  };
}
