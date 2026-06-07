import React from 'react';
import { I } from '../shared/StudioIcons';

export default function Mockup3DTool() {
    return (
        <div className="st-tool-coming-soon">
            <div className="st-tool-coming-soon-card">
                <div className="st-tool-coming-soon-icon" aria-hidden="true">
                    <I d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" s={32} />
                </div>
                <span className="st-tool-coming-soon-badge">Coming Soon</span>
                <h2>3D Mockup</h2>
                <p>
                    Real-time 3D garment and product previews are on the way. You will be able to tile patterns on
                    apparel and rotate mockups in the browser.
                </p>
                <div className="st-tool-coming-soon-features">
                    <span><I d="M5 13l4 4L19 7" s={14} /> T-shirt, dress &amp; tote previews</span>
                    <span><I d="M5 13l4 4L19 7" s={14} /> Adjustable pattern tiling</span>
                    <span><I d="M5 13l4 4L19 7" s={14} /> Drag to rotate · scroll to zoom</span>
                </div>
            </div>
        </div>
    );
}
