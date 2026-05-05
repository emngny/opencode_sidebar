---
name: vscode-extension-dev
description: 'VS Code extension development wizard. Use when: building a VS Code extension from scratch, adding features (sidebar, webview, commands), configuring package.json manifest, implementing VS Code API integrations, writing extension tests, debugging extensions, registering commands and activation events.'
argument-hint: '[what do you want to build?]'
---

# VS Code Extension Development Wizard

This skill guides you step-by-step through building VS Code extensions. At each stage, the agent asks questions and generates code based on your answers.

## When to Use

- Starting a new VS Code extension project
- Adding features (sidebar, webview, commands) to an existing extension
- Configuring the extension manifest (`package.json`)
- Implementing VS Code API integrations
- Writing and debugging extension tests

---

## Stage 1: Define What You're Building

Ask these questions first:

1. **What does the extension do?** (one-sentence summary)
2. **What type of extension?**
   - Sidebar / Tree View (custom panel in activity bar)
   - Webview Panel (HTML/React-based panel)
   - Editor Decoration (inline highlighting, CodeLens, gutter icons)
   - Status Bar / Command (simple command trigger)
   - Language Server / Formatter / Linter
   - Notebook Provider
3. **New project or adding to an existing one?**

## Stage 2: Project Scaffold

If new project, set up this structure:

```
my-extension/
├── package.json          # Extension manifest
├── tsconfig.json         # TypeScript config
├── .vscodeignore         # Files excluded from packaging
├── src/
│   └── extension.ts      # activate/deactivate entry point
└── .vscode/
    ├── launch.json       # Debug config
    └── tasks.json        # Build task
```

### package.json Template

```jsonc
{
  "name": "my-extension",
  "displayName": "My Extension",
  "description": "...",
  "version": "0.0.1",
  "publisher": "your-publisher-id",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "commands": []
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "typescript": "^5.3.0"
  }
}
```

### extension.ts Template

```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    // Register commands, providers, listeners here
}

export function deactivate() {
    // Cleanup (timers, file watchers, etc.)
}
```

## Stage 3: Commands & Activation

### Registering a Command

```typescript
const disposable = vscode.commands.registerCommand('myext.helloWorld', () => {
    vscode.window.showInformationMessage('Hello World!');
});
context.subscriptions.push(disposable);
```

### Activation Events

| Event | When It Fires |
|-------|---------------|
| `onCommand:myext.cmd` | When the command is invoked |
| `onLanguage:python` | When a file of that language opens |
| `onView:myViewId` | When the view becomes visible |
| `*` | On VS Code startup (avoid if possible) |
| `onStartupFinished` | After startup completes |
| `onCustomEditor:myExt.editor` | When a custom editor opens |

## Stage 4: UI Components

### Sidebar / Tree View Provider

```typescript
class MyTreeDataProvider implements vscode.TreeDataProvider<MyTreeItem> {
    getTreeItem(element: MyTreeItem): vscode.TreeItem { return element; }
    getChildren(element?: MyTreeItem): Thenable<MyTreeItem[]> { /* ... */ }

    private _onDidChangeTreeData = new vscode.EventEmitter<MyTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void { this._onDidChangeTreeData.fire(undefined); }
}
```

Add to `package.json`:
```json
"contributes": {
  "views": {
    "explorer": [
      { "id": "myext.sidebar", "name": "My Sidebar" }
    ]
  }
}
```

### Webview Panel

```typescript
const panel = vscode.window.createWebviewPanel(
    'myPanel',
    'Panel Title',
    vscode.ViewColumn.One,
    { enableScripts: true }
);
panel.webview.html = getWebviewContent();
```

**Webview ↔ Extension Communication:**
- Extension → Webview: `panel.webview.postMessage({ type: 'update', data })`
- Webview → Extension: `acquireVsCodeApi().postMessage({ type: 'action' })`
- Extension listener: `panel.webview.onDidReceiveMessage(msg => { ... })`

### Status Bar Item

```typescript
const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
statusBarItem.text = "$(check) Ready";
statusBarItem.command = 'myext.statusClick';
statusBarItem.show();
context.subscriptions.push(statusBarItem);
```

## Stage 5: Common VS Code API Patterns

| API | Use Case |
|-----|----------|
| `vscode.window.showInformationMessage()` | Info / warning / error notifications |
| `vscode.window.showInputBox()` | Get text input from user |
| `vscode.window.showQuickPick()` | List selection from user |
| `vscode.window.activeTextEditor` | Currently active editor |
| `vscode.workspace.getConfiguration()` | Read settings |
| `vscode.workspace.onDidChangeTextDocument()` | Listen for document changes |
| `vscode.workspace.openTextDocument()` | Open a document programmatically |
| `vscode.Uri.file(path)` | Create file URI |
| `context.globalState` / `context.workspaceState` | Persistent key-value storage |
| `context.secrets` | Store sensitive data (tokens, keys) |
| `vscode.window.withProgress()` | Show progress UI for long operations |

## Stage 6: Testing & Debugging

### Launch Config (.vscode/launch.json)

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/out/**/*.js"]
    }
  ]
}
```

### Extension Tests

```bash
npm install --save-dev @vscode/test-electron @vscode/test-cli mocha @types/mocha
```

```typescript
// src/test/runTest.ts
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    await runTests({
        extensionDevelopmentPath: path.resolve(__dirname, '../../'),
        extensionTestsPath: path.resolve(__dirname, './suite/index')
    });
}
main().catch(console.error);
```

---

## Checklist

Validate these at each stage:

- [ ] `package.json` `main` field points to correct output file
- [ ] `activationEvents` are defined and correct
- [ ] All commands are listed in `contributes.commands`
- [ ] Disposables are pushed to `context.subscriptions` for cleanup
- [ ] Webview has `enableScripts: true` and Content Security Policy set
- [ ] `.vscodeignore` excludes unnecessary files from packaging
- [ ] `F5` launches the Extension Development Host successfully