import React, { useMemo, useRef, useEffect } from 'react';
import { marked } from 'marked';

interface Props {
  content: string;
}

export function Markdown({ content }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    const raw = marked.parse(content, { gfm: true, breaks: true }) as string;
    return raw.replace(/<pre>/g, '<pre><button class="copy-btn">Copy</button>');
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
      <style>{`
        .opencode-markdown h1,.opencode-markdown h2,.opencode-markdown h3,
        .opencode-markdown h4,.opencode-markdown h5,.opencode-markdown h6 {
          margin: 12px 0 6px; font-weight: 600; color: #cdd6f4;
        }
        .opencode-markdown h1 { font-size: 18px; }
        .opencode-markdown h2 { font-size: 16px; }
        .opencode-markdown h3 { font-size: 14px; }
        .opencode-markdown h4 { font-size: 13px; }
        .opencode-markdown p { margin: 4px 0; }
        .opencode-markdown ul, .opencode-markdown ol { margin: 4px 0; padding-left: 20px; }
        .opencode-markdown li { margin: 2px 0; }
        .opencode-markdown blockquote {
          margin: 6px 0; padding: 4px 12px;
          border-left: 3px solid #7c3aed; color: #a6adc8;
          background: rgba(124,58,237,0.05); border-radius: 0 4px 4px 0;
        }
        .opencode-markdown code {
          font-family: 'Cascadia Code','Fira Code','Consolas',monospace; font-size: 12px;
          background: #313244; padding: 1px 5px; border-radius: 4px; color: #f5c2e7;
        }
        .opencode-markdown pre {
          margin: 8px 0; padding: 12px 14px; padding-top: 32px; background: #11111b;
          border-radius: 10px; border: 1px solid #313244;
          overflow-x: auto; position: relative;
        }
        .opencode-markdown pre code {
          background: none; padding: 0; color: #cdd6f4; font-size: 12px; line-height: 1.5;
        }
        .opencode-markdown a { color: #89b4fa; text-decoration: none; }
        .opencode-markdown a:hover { text-decoration: underline; }
        .opencode-markdown table { border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 12px; }
        .opencode-markdown th,.opencode-markdown td {
          border: 1px solid #45475a; padding: 6px 10px; text-align: left;
        }
        .opencode-markdown th { background: #313244; font-weight: 600; }
        .opencode-markdown tr:nth-child(even) { background: rgba(49,50,68,0.3); }
        .opencode-markdown img { max-width: 100%; border-radius: 8px; margin: 8px 0; }
        .opencode-markdown hr { border: none; border-top: 1px solid #45475a; margin: 12px 0; }
        .opencode-markdown .copy-btn {
          position: absolute; top: 6px; right: 6px; padding: 3px 8px; font-size: 11px;
          border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #a6adc8;
          cursor: pointer; opacity: 0; transition: opacity 0.15s; z-index: 1;
        }
        .opencode-markdown pre:hover .copy-btn { opacity: 1; }
        .opencode-markdown .copy-btn:hover { background: #45475a; color: #cdd6f4; }
      `}</style>
    </div>
  );
}
