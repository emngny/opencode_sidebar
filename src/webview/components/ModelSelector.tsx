import React, { useState, useRef, useEffect } from 'react';
import { COLORS, RADIUS, popupPanel } from '../styles';
import { hoverable } from '../hover';
import { Popup } from './Popup';

interface Props {
  model: string;
  onChange: (model: string) => void;
  availableModels: Array<{ id: string; name: string; providerId: string }>;
}

export function ModelSelector({ model, onChange, availableModels }: Readonly<Props>) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleClose = () => {
    setIsOpen(false);
    setSearch('');
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredModels = availableModels.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) || m.providerId.toLowerCase().includes(search.toLowerCase()),
  );

  const grouped = filteredModels.reduce(
    (acc, m) => {
      if (!acc[m.providerId]) acc[m.providerId] = [];
      acc[m.providerId].push(m);
      return acc;
    },
    {} as Record<string, typeof availableModels>,
  );

  const currentModel = availableModels.find((m) => m.id === model);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Model: ${currentModel?.name || model}. Change model`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: COLORS.textDim,
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: RADIUS.md,
          backgroundColor: isOpen ? COLORS.bgHover : 'transparent',
          border: 'none',
          fontFamily: 'inherit',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentModel?.name || model}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ marginLeft: 2 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <Popup
          label="Select model"
          modal={false}
          onClose={handleClose}
          backdrop={false}
          initialFocus={inputRef}
          triggerRef={triggerRef}
          style={{
            ...popupPanel,
            left: 0,
            right: 0,
            marginBottom: 8,
            maxHeight: 320,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Search Bar */}
          <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.bgHover}` }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: RADIUS.lg,
                border: `1px solid ${COLORS.border}`,
                backgroundColor: COLORS.bgHover,
                color: COLORS.text,
                fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Models List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {Object.keys(grouped).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: COLORS.textMuted, fontSize: 13 }}>
                Model not found
              </div>
            ) : (
              Object.entries(grouped).map(([providerId, models]) => (
                <div key={providerId}>
                  <div
                    style={{
                      fontSize: 11,
                      color: COLORS.textMuted,
                      fontWeight: 600,
                      padding: '8px 0 4px',
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    {providerId}
                  </div>
                  {models.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => {
                        onChange(m.id);
                        handleClose();
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: RADIUS.lg,
                        cursor: 'pointer',
                        backgroundColor: m.id === model ? COLORS.bgHover : 'transparent',
                      }}
                      {...hoverable(
                        { backgroundColor: COLORS.bgLight },
                        // The selected row keeps its own fill; hovering it must
                        // not flash the resting colour.
                        () => ({ backgroundColor: m.id === model ? COLORS.bgHover : 'transparent' }),
                      )}
                    >
                      <span style={{ fontSize: 13, color: COLORS.text }}>{m.name}</span>
                      {m.id === model && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={COLORS.green}
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </Popup>
      )}
    </div>
  );
}
