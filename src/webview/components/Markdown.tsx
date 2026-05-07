import React, { useMemo, useRef, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface Props {
  content: string;
}

export function Markdown({ content }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    const raw = marked.parse(content, { gfm: true, breaks: true }) as string;
    const withCopyBtns = raw.replace(/<pre>/g, '<pre><button class="copy-btn">Copy</button>');
    return DOMPurify.sanitize(withCopyBtns, {
      ADD_ATTR: ['class'],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[a-z]+:)/i,
    });
  }, [content]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handler = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.copy-btn');
      if (!btn) return;
      const pre = btn.closest('pre');
      const code = pre?.querySelector('code');
      if (!code) return;
      navigator.clipboard.writeText(code.textContent || '').then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      }).catch(() => {});
    };
    root.addEventListener('click', handler);
    return () => root.removeEventListener('click', handler);
  }, [html]);

  const handleLinkClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (a && a.getAttribute('href') && !a.getAttribute('href')?.startsWith('#')) {
      e.preventDefault();
    }
  };

  return (
    <div ref={rootRef} className="opencode-markdown" style={{
      fontSize: 13, lineHeight: 1.6, color: '#cdd6f4', wordBreak: 'break-word',
    }}>
      <div dangerouslySetInnerHTML={{ __html: html }} onClick={handleLinkClick} />
    </div>
  );
}
