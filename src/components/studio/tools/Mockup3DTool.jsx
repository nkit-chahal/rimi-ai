import React, { Suspense, lazy, useMemo, useState } from 'react';
import { I } from '../shared/StudioIcons';
import ProToolLock from '../shared/ProToolLock';

const GarmentPreview3D = lazy(() => import('../../GarmentPreview3D'));

const GARMENT_TYPES = [
    { id: 'tshirt', label: 'T-Shirt' },
    { id: 'dress', label: 'Dress' },
    { id: 'totebag', label: 'Tote Bag' },
];

export default function Mockup3DTool({ preview, activeProject, controls, user, setTool, currentToken }) {
    const [garmentType, setGarmentType] = useState('tshirt');
    const [tileX, setTileX] = useState(controls?.gridSize || 4);
    const [tileY, setTileY] = useState(controls?.gridSize || 4);

    // Pass raw /results/ paths — GarmentPreview3D resolves file access tokens.
    const patternUrl = useMemo(() => {
        if (preview) return preview;
        return activeProject?.heroImageUrl || null;
    }, [preview, activeProject?.heroImageUrl]);

    return (
        <div className="st-mockup3d-tool" style={{ position: 'relative' }}>
            <ProToolLock
                user={user}
                featureName="3D Mockup"
                onOpenBilling={() => typeof setTool === 'function' && setTool('billing')}
            />
            <div className="st-mockup3d-controls">
                <div className="st-mockup3d-garment-tabs">
                    {GARMENT_TYPES.map((g) => (
                        <button
                            key={g.id}
                            type="button"
                            className={garmentType === g.id ? 'active' : ''}
                            onClick={() => setGarmentType(g.id)}
                        >
                            {g.label}
                        </button>
                    ))}
                </div>
                <div className="st-mockup3d-tile-sliders">
                    <label>
                        Tile X
                        <input type="range" min={1} max={12} value={tileX} onChange={(e) => setTileX(Number(e.target.value))} />
                        <span>{tileX}</span>
                    </label>
                    <label>
                        Tile Y
                        <input type="range" min={1} max={12} value={tileY} onChange={(e) => setTileY(Number(e.target.value))} />
                        <span>{tileY}</span>
                    </label>
                </div>
            </div>

            <div className="st-mockup3d-viewport" style={{ minHeight: 420 }}>
                {!patternUrl ? (
                    <div className="st-empty-canvas">
                        <span className="st-empty-icon"><I d="M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" s={32} /></span>
                        <p>Upload a pattern or open a project with artwork to preview on 3D garments.</p>
                    </div>
                ) : (
                    <Suspense fallback={<div className="tool-loading">Loading 3D preview…</div>}>
                        <GarmentPreview3D
                            patternUrl={patternUrl}
                            garmentType={garmentType}
                            tileX={tileX}
                            tileY={tileY}
                            autoRotate
                            token={currentToken}
                        />
                    </Suspense>
                )}
            </div>
        </div>
    );
}
