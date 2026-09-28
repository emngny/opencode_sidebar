import React, { useMemo, useRef, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { postMessage } from '../vscode-api';
import { COLORS } from '../styles';

interface Props {
  content: string;
}

/** Schemes DOMPurify allows through; the extension re-checks on arrival. */
const EXTERNAL_SCHEME = /^(?:https?|mailto):/i;

export function Markdown({ content }: Readonly<Props>) {
  const rootRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    const raw = marked.parse(content, { gfm: true, breaks: true }) as string;
    const sanitized = DOMPurify.sanitize(raw, {
      ADD_ATTR: ['class'],
      ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
    });
    return sanitized.replaceAll('<pre>', '<pre><button class="copy-btn">Copy</button>');
  }, [content]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      const href = link?.getAttribute('href');
      // In-page anchors scroll natively; every other link leaves the webview,
      // which only the extension host can do.
      if (href && !href.startsWith('#')) {
        e.preventDefault();
        if (EXTERNAL_SCHEME.test(href)) postMessage({ type: 'openExternal', payload: { url: href } });
        return;
      }

      const btn = target.closest('.copy-btn');
      if (!btn) return;
      const pre = btn.closest('pre');
      const code = pre?.querySelector('code');
      if (!code) return;
      navigator.clipboard
        .writeText(code.textContent || '')
        .then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => {
            btn.textContent = 'Copy';
          }, 2000);
        })
        .catch(() => {});
    };
    root.addEventListener('click', handler);
    return () => root.removeEventListener('click', handler);
  }, [html]);

  return (
    <div
      ref={rootRef}
      className="opencode-markdown"
      style={{
        fontSize: 13,
        lineHeight: 1.6,
        color: COLORS.text,
        wordBreak: 'break-word',
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
