import React, { useEffect, useMemo, useRef } from 'react';
import { I } from './StudioIcons';

export default function StudioCommandPalette({ open, query, onQueryChange, onClose, items, onSelect }) {
    const inputRef = useRef(null);

    useEffect(() => {
        if (open) {
            inputRef.current?.focus();
        }
    }, [open]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter((item) =>
            item.label.toLowerCase().includes(q) ||
            item.section?.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q)
        );
    }, [items, query]);

    if (!open) return null;

    return (
        <div className="st-command-palette-overlay" onClick={onClose} role="presentation">
            <div
                className="st-command-palette"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Jump to tool"
            >
                <div className="st-command-palette-input-wrap">
                    <I d="M21 21l-4.3-4.3M10 18a8 8 0 100-16 8 8 0 000 16z" s={16} />
                    <input
                        ref={inputRef}
                        type="search"
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        placeholder="Search tools and sections..."
                        aria-label="Search tools"
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') onClose();
                            if (e.key === 'Enter' && filtered[0]) {
                                onSelect(filtered[0].id);
                                onClose();
                            }
                        }}
                    />
                    <kbd>Esc</kbd>
                </div>
                <div className="st-command-palette-list" role="listbox">
                    {filtered.length === 0 ? (
                        <div className="st-command-palette-empty">No matching tools</div>
                    ) : (
                        filtered.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className="st-command-palette-item"
                                onClick={() => {
                                    onSelect(item.id);
                                    onClose();
                                }}
                                role="option"
                            >
                                <I d={item.icon} s={16} />
                                <span className="st-command-palette-item-label">{item.label}</span>
                                {item.section && <span className="st-command-palette-item-section">{item.section}</span>}
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
