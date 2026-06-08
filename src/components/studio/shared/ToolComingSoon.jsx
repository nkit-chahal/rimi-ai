import React from 'react';
import { I } from './StudioIcons';

export default function ToolComingSoon({ title, description, features = [], icon }) {
    return (
        <div className="st-tool-coming-soon">
            <div className="st-tool-coming-soon-card">
                <div className="st-tool-coming-soon-icon" aria-hidden="true">
                    <I d={icon} s={32} />
                </div>
                <span className="st-tool-coming-soon-badge">Coming Soon</span>
                <h2>{title}</h2>
                <p>{description}</p>
                {features.length > 0 && (
                    <div className="st-tool-coming-soon-features">
                        {features.map((feature) => (
                            <span key={feature}><I d="M5 13l4 4L19 7" s={14} /> {feature}</span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
