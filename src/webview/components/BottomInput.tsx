import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ContextPart } from '../../extension/types';
import { CommandItem } from '../slashCommands';
import { SlashCommandPopup } from './SlashCommandPopup';

interface FileResult {
  name: string;
  path: string;
}

interface Props {
  onSend: (text: string, context: ContextPart[]) => void;
  disabled: boolean;
  onSearchFiles: (query: string) => void;
  fileSearchResults: FileResult[];
  fileSearchQuery: string;
  onSlashCommand?: (cmd: CommandItem) => void;
  skills?: Array<{ name: string; description?: string }>;
}

export function BottomInput({ onSend, disabled, onSearchFiles, fileSearchResults, fileSearchQuery, onSlashCommand, skills }: Readonly<Props>) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ContextPart[]>([]);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [fileSearchInput, setFileSearchInput] = useState('');
  const [mentionEnabled, setMentionEnabled] = useState(false);
  const [showSlashPopup, setShowSlashPopup] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileSearchRef = useRef<HTMLDivElement>(null);
  const slashPopupRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [text]);

  // Close file search on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fileSearchRef.current && !fileSearchRef.current.contains(e.target as Node)) {
        setShowFileSearch(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close slash popup on outside click
  useEffect(() => {
    if (!showSlashPopup) return;
    const handler = (e: MouseEvent) => {
      if (slashPopupRef.current && !slashPopupRef.current.contains(e.target as Node) &&
          textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setShowSlashPopup(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSlashPopup]);

  const handleSend = () => {
    if ((!text.trim() && attachments.length === 0) || disabled) return;
    onSend(text.trim(), attachments);
    setText('');
    setAttachments([]);
    setShowSlashPopup(false);
  };

  const handleSlashSelect = (cmd: CommandItem) => {
    setText('');
    setShowSlashPopup(false);
    onSlashCommand?.(cmd);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !disabled) {
      if (showSlashPopup) {
        // Let the popup handle Enter
        return;
      }
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Detect @mention
    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0) {
      const afterAt = val.slice(lastAt + 1);
      if (!afterAt.includes(' ') && afterAt.length < 50) {
        setMentionEnabled(true);
        setFileSearchInput(afterAt);
        setShowFileSearch(true);
        onSearchFiles(afterAt);
      } else {
        if (mentionEnabled) setMentionEnabled(false);
      }
    } else {
      if (mentionEnabled) setMentionEnabled(false);
    }

    // Detect / slash command at start
    const trimmed = val.trimStart();
    if (trimmed.startsWith('/') && !val.includes(' ')) {
      const afterSlash = trimmed.slice(1);
      setSlashFilter(afterSlash);
      setShowSlashPopup(true);
      setShowFileSearch(false);
    } else {
      setShowSlashPopup(false);
    }
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          setAttachments((prev) => [
            ...prev,
            { type: 'image', name: file.name || 'paste.png', data: base64, mimeType: file.type || 'image/png' },
          ]);
        };
        reader.readAsDataURL(file);
      }
    }
  }, []);

  const handleFileSelect = (file: FileResult) => {
    const val = text;
    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0) {
      setText(val.slice(0, lastAt) + ' ');
    }
    setAttachments((prev) => [...prev, { type: 'file', name: file.name, path: file.path }]);
    setShowFileSearch(false);
    setMentionEnabled(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePlusClick = () => {
    if (showFileSearch) {
      setShowFileSearch(false);
      return;
    }
    setFileSearchInput('');
    setShowFileSearch(true);
    onSearchFiles('');
  };

  const handleFileSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && fileSearchResults.length > 0) {
      handleFileSelect(fileSearchResults[0]);
    }
    if (e.key === 'Escape') {
      setShowFileSearch(false);
    }
  };

  const canSend = text.trim().length > 0 || attachments.length > 0;

  return (
    <div style={{ padding: '12px 16px', backgroundColor: '#181825', position: 'relative' }}>
      {/* Slash Command Popup */}
      {showSlashPopup && (
        <div ref={slashPopupRef}>
          <SlashCommandPopup
            filter={slashFilter}
            skills={skills || []}
            onSelect={handleSlashSelect}
            onClose={() => setShowSlashPopup(false)}
          />
        </div>
      )}
      {/* File Search Popup */}
      {showFileSearch && (
        <div
          ref={fileSearchRef}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 16,
            right: 16,
            maxHeight: 250,
            overflowY: 'auto',
            backgroundColor: '#1e1e2e',
            border: '1px solid #45475a',
            borderRadius: 12,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
            zIndex: 100,
          }}
        >
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #313244' }}>
            <input
              autoFocus
              value={fileSearchInput}
              onChange={(e) => {
                setFileSearchInput(e.target.value);
                onSearchFiles(e.target.value);
              }}
              onKeyDown={handleFileSearchKeyDown}
              placeholder="Search files..."
              style={{
                width: '100%',
                backgroundColor: '#313244',
                border: 'none',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#cdd6f4',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          {fileSearchResults.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: '#6c7086', fontSize: 12 }}>
              No results found
            </div>
          ) : (
            fileSearchResults.map((file) => (
              <div
                key={file.path}
                onClick={() => handleFileSelect(file)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#313244')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#6c7086' }}>{file.path}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {attachments.map((att, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                backgroundColor: '#313244',
                borderRadius: 8,
                fontSize: 12,
                color: '#cdd6f4',
                maxWidth: '100%',
              }}
            >
              {att.type === 'image' ? (
                <>
                  <img
                    src={`data:${att.mimeType};base64,${att.data}`}
                    alt=""
                    style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                    {att.name}
                  </span>
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#89b4fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                    {att.name}
                  </span>
                </>
              )}
              <button
                onClick={() => removeAttachment(i)}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#6c7086',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Container */}
      <div
        style={{
          backgroundColor: '#313244',
          borderRadius: 16,
          border: '1px solid #45475a',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          placeholder='Ask something... (/ for commands, @ to search files, Ctrl+V to paste images)'
          style={{
            backgroundColor: 'transparent',
            border: 'none',
            color: '#cdd6f4',
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'none',
            outline: 'none',
            width: '100%',
            minHeight: 22,
            maxHeight: 120,
            overflowY: 'auto',
            lineHeight: 1.5,
          }}
        />

        {/* Buttons Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={handlePlusClick}
            disabled={disabled}
            style={{
              backgroundColor: 'transparent',
              border: 'none',
              color: showFileSearch ? '#89b4fa' : '#a6adc8',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#cdd6f4')}
            onMouseLeave={(e) => (e.currentTarget.style.color = showFileSearch ? '#89b4fa' : '#a6adc8')}
            title="Dosya ekle"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <button
            onClick={handleSend}
            disabled={disabled || !canSend}
            style={{
              backgroundColor: disabled || !canSend ? '#45475a' : '#7c3aed',
              border: 'none',
              color: '#fff',
              cursor: disabled || !canSend ? 'not-allowed' : 'pointer',
              padding: '6px 10px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s',
              opacity: disabled || !canSend ? 0.6 : 1,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
