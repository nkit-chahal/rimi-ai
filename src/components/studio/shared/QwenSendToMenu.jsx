import React, { useState } from 'react';
import { openFileInTool } from '../shared/helpers';

const SEND_TARGETS = [
    { id: 'seamless', label: 'Seamless' },
    { id: 'repeat', label: 'Repeat' },
    { id: 'colorways', label: 'Colorways' },
    { id: 'vectorize', label: 'Vectorize' },
    { id: 'removebg', label: 'Remove BG' },
    { id: 'pattern', label: 'Pattern' },
];

export default function QwenSendToMenu({ url, filename, setters, className = '', label, compact = false }) {
    const [open, setOpen] = useState(false);

    if (!url && !filename) return null;

    const btnClass = compact ? 'st-layer-icon-btn' : 'st-layer-toolbar-btn st-qwen-action-btn';

    return (
        <div className={`st-qwen-send-menu ${className}`} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button
                type="button"
                className={btnClass}
                title="Send to another tool"
                onClick={() => setOpen((v) => !v)}
            >
                {label || 'Send to…'}
            </button>
            {open && (
                <div className="st-qwen-send-dropdown" style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    zIndex: 20,
                    minWidth: 140,
                    background: 'rgba(8,13,25,0.96)',
                    border: '1px solid rgba(103,232,249,0.28)',
                    borderRadius: 8,
                    padding: '0.35rem',
                    marginTop: 4,
                }}>
                    {SEND_TARGETS.map((target) => (
                        <button
                            key={target.id}
                            type="button"
                            className="st-qwen-send-item"
                            style={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                padding: '0.4rem 0.55rem',
                                background: 'transparent',
                                border: 'none',
                                color: '#e5f3ff',
                                fontSize: '0.78rem',
                                cursor: 'pointer',
                            }}
                            onClick={() => {
                                openFileInTool({ url, filename }, target.id, setters);
                                setOpen(false);
                            }}
                        >
                            {target.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
