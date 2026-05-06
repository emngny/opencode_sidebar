import React, { useState, useRef, useEffect } from 'react';

interface Props {
  model: string;
  onChange: (model: string) => void;
  availableModels: Array<{ id: string; name: string; providerId: string }>;
}

export function ModelSelector({ model, onChange, availableModels }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const filteredModels = availableModels.filter(
    (m) => m.name.toLowerCase().includes(search.toLowerCase()) || m.providerId.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = filteredModels.reduce((acc, m) => {
    if (!acc[m.providerId]) acc[m.providerId] = [];
    acc[m.providerId].push(m);
    return acc;
  }, {} as Record<string, typeof availableModels>);

  const currentModel = availableModels.find((m) => m.id === model);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: '#a6adc8',
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: 6,
          backgroundColor: isOpen ? '#313244' : 'transparent',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentModel?.name || model}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 2 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: 8,
            backgroundColor: '#1e1e2e',
            border: '1px solid #313244',
            borderRadius: 12,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
            maxHeight: 320,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 100,
          }}
        >
          {/* Search Bar */}
          <div style={{ padding: 12, borderBottom: '1px solid #313244' }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Model ara..."
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #45475a',
                backgroundColor: '#313244',
                color: '#cdd6f4',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Models List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {Object.keys(grouped).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#585b70', fontSize: 13 }}>
                Model not found
              </div>
            ) : (
              Object.entries(grouped).map(([providerId, models]) => (
                <div key={providerId}>
                  <div
                    style={{
                      fontSize: 11,
                      color: '#585b70',
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
                        setIsOpen(false);
                        setSearch('');
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        backgroundColor: m.id === model ? '#313244' : 'transparent',
                      }}
                      onMouseEnter={(e) => { if (m.id !== model) e.currentTarget.style.backgroundColor = '#181825'; }}
                      onMouseLeave={(e) => { if (m.id !== model) e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <span style={{ fontSize: 13, color: '#cdd6f4' }}>{m.name}</span>
                      {m.id === model && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a6e3a1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}