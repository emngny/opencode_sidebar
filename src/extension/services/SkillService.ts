import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

export interface SkillSummary {
  name: string;
  description?: string;
}

export class SkillService {
  private _skillsDir(): string | null {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? path.join(root, '.agents', 'skills') : null;
  }

  list(): SkillSummary[] {
    const skillsDir = this._skillsDir();
    if (!skillsDir || !existsSync(skillsDir)) return [];
    try {
      const result: SkillSummary[] = [];
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
        if (!existsSync(skillMdPath)) continue;
        const lines = readFileSync(skillMdPath, 'utf-8').split('\n');
        const heading = lines.find((line) => line.startsWith('# ') || line.startsWith('## ')) || lines[0];
        result.push({ name: entry.name, description: heading.replace(/^#+ /, '').trim() });
      }
      return result;
    } catch (error) {
      console.warn('[opencode] Load skills failed:', error);
      return [];
    }
  }

  load(name: string): string | null {
    const skillsDir = this._skillsDir();
    if (!skillsDir) return null;
    const skillMdPath = path.join(skillsDir, name, 'SKILL.md');
    if (!existsSync(skillMdPath)) return null;
    try {
      return readFileSync(skillMdPath, 'utf-8');
    } catch (error) {
      console.warn('[opencode] Load skill content failed:', error);
      return null;
    }
  }

  createAgentsFile(): { status: 'created' | 'exists' | 'error'; message?: string } {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return { status: 'error' };
    const agentsMdPath = path.join(root, 'AGENTS.md');
    if (existsSync(agentsMdPath)) return { status: 'exists' };
    const content = `# Project Guide for Opencode AI\n\n## Project Overview\n- **What does this project do?**\n-\n\n## Conventions\n-\n\n## Commands\n- **Build:**\n- **Test:**\n- **Lint:**\n\n## Key Files\n- **Entry point:**\n- **Configuration:**\n`;
    try {
      writeFileSync(agentsMdPath, content, 'utf-8');
      return { status: 'created' };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }
}
