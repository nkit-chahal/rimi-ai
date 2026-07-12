import React from 'react';
import { I } from './StudioIcons';

export default function ProLockScreen({
    title = 'Pro feature',
    description = 'Upgrade to Pro to unlock this tool.',
    features = [],
    setTool,
}) {
    return (
        <div className="st-pro-lock">
            <span className="st-pro-badge">Pro</span>
            <h2>{title}</h2>
            <p>{description}</p>
            {features.length > 0 && (
                <ul className="st-pro-lock-features">
                    {features.map((f) => (
                        <li key={f}>
                            <I d="M20 6L9 17l-5-5" s={14} /> {f}
                        </li>
                    ))}
                </ul>
            )}
            <button type="button" className="st-pro-lock-cta" onClick={() => setTool?.('billing')}>
                Upgrade to Pro
            </button>
        </div>
    );
}
