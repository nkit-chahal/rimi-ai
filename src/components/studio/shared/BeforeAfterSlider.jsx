import React, { useCallback, useRef, useState } from 'react';
import MediaImg from './MediaImg';

/** Side-by-side before/after comparison with draggable divider. */
export default function BeforeAfterSlider({ beforeUrl, afterUrl, token, onCommit, onDiscard }) {
    const wrapRef = useRef(null);
    const [split, setSplit] = useState(50);
    const dragging = useRef(false);

    const onMove = useCallback((clientX) => {
        const el = wrapRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const pct = Math.min(98, Math.max(2, ((clientX - rect.left) / rect.width) * 100));
        setSplit(pct);
    }, []);

    const onPointerDown = (e) => {
        dragging.current = true;
        onMove(e.clientX);
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
        if (!dragging.current) return;
        onMove(e.clientX);
    };

    const onPointerUp = () => {
        dragging.current = false;
    };

    return (
        <div className="st-before-after-overlay" style={{
            position: 'absolute', inset: 0, zIndex: 12,
            background: 'rgba(8,13,25,0.85)', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', padding: '1rem',
        }}>
            <div style={{ fontSize: '0.85rem', color: 'rgba(226,242,255,0.9)', marginBottom: '0.5rem', fontWeight: 600 }}>
                Compare edit — drag slider
            </div>
            <div
                ref={wrapRef}
                style={{
                    position: 'relative', width: 'min(100%, 640px)', aspectRatio: '1',
                    borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(103,232,249,0.25)',
                    cursor: 'ew-resize', userSelect: 'none', touchAction: 'none',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
            >
                <MediaImg src={afterUrl} alt="After" token={token} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                <div style={{
                    position: 'absolute', top: 0, left: 0, bottom: 0, width: `${split}%`,
                    overflow: 'hidden', borderRight: '2px solid #67e8f9',
                }}>
                    <MediaImg src={beforeUrl} alt="Before" token={token} style={{ width: `${100 / (split / 100)}%`, maxWidth: 'none', height: '100%', objectFit: 'contain' }} />
                </div>
                <div style={{
                    position: 'absolute', top: '50%', left: `${split}%`, transform: 'translate(-50%, -50%)',
                    width: 28, height: 28, borderRadius: '50%', background: '#67e8f9', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: '#0f172a', fontWeight: 800,
                }}>⇔</div>
                <span style={{ position: 'absolute', top: 8, left: 8, fontSize: '0.65rem', background: 'rgba(0,0,0,0.55)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>Before</span>
                <span style={{ position: 'absolute', top: 8, right: 8, fontSize: '0.65rem', background: 'rgba(0,0,0,0.55)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>After</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button type="button" className="st-layer-toolbar-btn st-qwen-action-btn" onClick={onCommit}>Commit</button>
                <button type="button" className="st-layer-toolbar-btn" onClick={onDiscard}>Discard</button>
            </div>
        </div>
    );
}
