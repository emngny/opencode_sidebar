import * as vscode from 'vscode';
import { getNonce } from '../utils';

export class WebviewHtmlBuilder {
  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _serverUrl: () => string | undefined,
  ) {}

  build(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'));
    const styleNonce = getNonce();
    const scriptNonce = getNonce();
    const serverPort = this._serverUrl() ? new URL(this._serverUrl()!).port : '*';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'self'; img-src ${webview.cspSource} data:; script-src 'nonce-${scriptNonce}'; style-src 'nonce-${styleNonce}'; connect-src ${webview.cspSource}${serverPort ? ` http://127.0.0.1:${serverPort} http://localhost:${serverPort}` : ''}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Opencode</title>
<style nonce="${styleNonce}">
body{margin:0;padding:0;width:100%;height:100vh;overflow:hidden;background-color:#1e1e2e;color:#cdd6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}#root{width:100%;height:100%;display:flex;flex-direction:column}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes blink{50%{opacity:0}}@keyframes thinking{0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}:focus-visible{outline:2px solid #89b4fa;outline-offset:2px}.opencode-markdown h1,.opencode-markdown h2,.opencode-markdown h3,.opencode-markdown h4,.opencode-markdown h5,.opencode-markdown h6{margin:12px 0 6px;font-weight:600;color:#cdd6f4}.opencode-markdown h1{font-size:18px}.opencode-markdown h2{font-size:16px}.opencode-markdown h3{font-size:14px}.opencode-markdown h4{font-size:13px}.opencode-markdown p{margin:4px 0}.opencode-markdown ul,.opencode-markdown ol{margin:4px 0;padding-left:20px}.opencode-markdown li{margin:2px 0}.opencode-markdown blockquote{margin:6px 0;padding:4px 12px;border-left:3px solid #7c3aed;color:#a6adc8;background:rgba(124,58,237,.05);border-radius:0 4px 4px 0}.opencode-markdown code{font-family:'Cascadia Code','Fira Code',Consolas,monospace;font-size:12px;background:#313244;padding:1px 5px;border-radius:4px;color:#f5c2e7}.opencode-markdown pre{position:relative;background:#181825;border:1px solid #313244;border-radius:6px;padding:8px;overflow-x:auto;margin:6px 0}.opencode-markdown pre code{background:none;padding:0;color:#cdd6f4}.opencode-markdown a{color:#89b4fa}.opencode-markdown table{border-collapse:collapse;margin:6px 0}.opencode-markdown th,.opencode-markdown td{border:1px solid #45475a;padding:4px 8px}.opencode-markdown .copy-btn{position:absolute;top:6px;right:6px;padding:3px 8px;font-size:11px;border:1px solid #45475a;border-radius:6px;background:#313244;color:#a6adc8;cursor:pointer;opacity:0;transition:opacity .15s;z-index:1}.opencode-markdown pre:hover .copy-btn{opacity:1}.opencode-markdown .copy-btn:hover{background:#45475a;color:#cdd6f4}
</style>
</head>
<body><div id="root"></div><script nonce="${scriptNonce}" src="${scriptUri}"></script></body>
</html>`;
  }
}
