/**
 * Shared SVG icon component used across all Studio tools.
 * Extracted from Studio.jsx to avoid duplication.
 */
import React from 'react';

export const I = ({ d, s = 18 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
    </svg>
);

export default I;
