import * as path from 'node:path';
import { realpathSync } from 'node:fs';

export type WorkspacePathResult =
  { ok: true; resolvedPath: string; relativePath: string } | { ok: false; reason: string };

function isAbsoluteInput(input: string): boolean {
  return path.isAbsolute(input) || /^(?:[/\\]|[A-Za-z]:[/\\]|\\\\)/.test(input);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return false;
  return true;
}

function containsTraversal(input: string): boolean {
  return input.split(/[\\/]+/).includes('..');
}

/**
 * Resolve a webview-provided path without allowing escape from the workspace.
 * The lexical check is authoritative; realpath additionally blocks symlink escapes
 * when the target exists. A caller should still read the resolved path immediately.
 */
export function resolveWorkspacePath(root: string, input: string): WorkspacePathResult {
  if (!root || !input || isAbsoluteInput(input)) return { ok: false, reason: 'Path must be relative to workspace' };

  let decodedInput = input;
  try {
    decodedInput = decodeURIComponent(input);
  } catch {
    // Keep the original value; lexical validation below still applies.
  }
  if (isAbsoluteInput(decodedInput) || containsTraversal(decodedInput)) {
    return { ok: false, reason: 'Path escapes workspace' };
  }

  const rootPath = path.resolve(root);
  const resolvedPath = path.resolve(rootPath, decodedInput.replaceAll('/', path.sep));
  if (!isInside(rootPath, resolvedPath)) return { ok: false, reason: 'Path escapes workspace' };

  let canonicalPath = resolvedPath;
  try {
    canonicalPath = realpathSync.native(resolvedPath);
  } catch {
    // Non-existent files cannot be canonicalized yet; lexical containment still applies.
  }
  if (!isInside(rootPath, canonicalPath)) return { ok: false, reason: 'Path escapes workspace' };

  return {
    ok: true,
    resolvedPath: canonicalPath,
    relativePath: path.relative(rootPath, resolvedPath),
  };
}
