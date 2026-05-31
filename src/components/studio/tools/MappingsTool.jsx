import React, { useState, useRef } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';

const MAPPING_CATEGORIES = [
    { id: 'home', label: 'Home', desc: 'Bedding, decor, kitchen', icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z' },
    { id: 'apparel', label: 'Apparel', desc: 'Clothing, fashion, wear', icon: 'M20.38 3.46L16 2 12 5.5 8 2 3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47c.06.37.29.7.62.89L8 12.75V21h8v-8.25l4.52-2.7c.33-.19.56-.52.62-.89l.58-3.47a2 2 0 00-1.34-2.23z' },
    { id: 'accessories', label: 'Accessories', desc: 'Bags, cases, small items', icon: 'M20 7h-4V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v3H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM10 4h4v3h-4V4z' },
    { id: 'wall_art', label: 'Wall Art', desc: 'Frames, canvases, decor', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'other', label: 'Other', desc: 'Custom products', icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' },
];

const MAPPING_PRODUCTS = {
    home: [
        { id: 'bed_sheet', name: 'Bed Sheet', image: '/products/bed_sheet.png' },
        { id: 'pillow_cover', name: 'Pillow Cover', image: '/products/pillow_cover.png' },
        { id: 'comforter', name: 'Comforter', image: '/products/comforter.png' },
        { id: 'cushion', name: 'Cushion', image: '/products/cushion.png' },
    ],
    apparel: [
        { id: 'tshirt', name: 'T-Shirt', image: '/products/tshirt.png' },
    ],
    accessories: [
        { id: 'tote_bag', name: 'Tote Bag', image: '/products/tote_bag.png' },
    ],
    wall_art: [
        { id: 'cushion', name: 'Canvas Print', image: '/products/cushion.png' },
    ],
    other: [],
};

export default function MappingsTool({ uploaded, preview, activeProject, user, controls, setError, addBgTask }) {
    // ===== LOCAL STATE =====
    const [mappingStep, setMappingStep] = useState(1);
    const [mappingPrint, setMappingPrint] = useState(null);
    const [mappingPrintPreview, setMappingPrintPreview] = useState(null);
    const [mappingCategory, setMappingCategory] = useState('home');
    const [mappingSelectedProducts, setMappingSelectedProducts] = useState(new Set());
    const [mappingControls, setMappingControls] = useState({ scale: 120, posX: 10, posY: -5, rotate: 0, flipH: false, flipV: false });
    const [mappingResults, setMappingResults] = useState([]);
    const [isMappingGenerating, setIsMappingGenerating] = useState(false);
    const [mappingProductSearch, setMappingProductSearch] = useState('');
    const mapFileRef = useRef(null);

    // ===== HANDLERS =====
    const handleMappingUpload = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => setMappingPrintPreview(e.target.result);
        reader.readAsDataURL(file);
        const fd = new FormData();
        fd.append('image', file);
        fetch(`${API}/api/upload`, { method: 'POST', body: fd })
            .then(r => r.json())
            .then(d => {
                if (d.success) setMappingPrint({ file, filename: d.filename, url: d.url });
            })
            .catch(() => setError('Upload failed'));
    };

    const toggleMappingProduct = (productId) => {
        setMappingSelectedProducts(prev => {
            const next = new Set(prev);
            if (next.has(productId)) next.delete(productId); else next.add(productId);
            return next;
        });
    };

    const generateMockups = async () => {
        if (!mappingPrint?.filename || mappingSelectedProducts.size === 0) return;
        setIsMappingGenerating(true);
        setMappingResults([]);
        setError('');

        const trigger = async () => {
            const r = await fetch(`${API}/api/generate-mockups-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patternFilename: mappingPrint.filename,
                    products: Array.from(mappingSelectedProducts),
                    category: mappingCategory,
                    projectId: activeProject.id,
                }),
            });
            const d = await r.json();
            if (d.success && d.mockups) {
                setMappingResults(d.mockups);
                setMappingStep(4);
                setIsMappingGenerating(false);
                return { url: d.mockups[0]?.mockupUrl, urls: d.mockups.map(m => m.mockupUrl) };
            } else {
                setIsMappingGenerating(false);
                throw new Error(d.error || 'Failed to generate mockups');
            }
        };

        addBgTask('mappings', `Apparel Mapping: ${mappingSelectedProducts.size} item(s)`, mappingPrint.filename, trigger);
    };

    // ===== RENDER =====
    const STEPS = ['Upload Print', 'Select Category', 'Choose Products', 'Map & Preview'];
    const currentProducts = MAPPING_PRODUCTS[mappingCategory] || [];
    const filteredProducts = mappingProductSearch
        ? currentProducts.filter(p => p.name.toLowerCase().includes(mappingProductSearch.toLowerCase()))
        : currentProducts;

    return (
        <div className="st-map-wizard">
            {/* Step indicator */}
            <div className="st-map-steps">
                {STEPS.map((label, i) => (
                    <React.Fragment key={i}>
                        <div
                            className={`st-map-step ${mappingStep === i + 1 ? 'active' : ''} ${mappingStep > i + 1 ? 'completed' : ''}`}
                            onClick={() => { if (i + 1 < mappingStep || (i + 1 === 2 && mappingPrint)) setMappingStep(i + 1); }}
                        >
                            <div className="st-map-step-num">
                                {mappingStep > i + 1 ? '✓' : i + 1}
                            </div>
                            <span className="st-map-step-label">{label}</span>
                        </div>
                        {i < STEPS.length - 1 && (
                            <div className={`st-map-step-line ${mappingStep > i + 1 ? 'done' : ''}`} />
                        )}
                    </React.Fragment>
                ))}
            </div>

            {/* Step 1: Upload Print */}
            {mappingStep >= 1 && (
                <div className="st-map-section">
                    <h2 className="st-map-section-title">Upload Your Print</h2>
                    <p className="st-map-section-desc">Upload a high quality print or pattern</p>
                    <div className="st-map-upload-row">
                        <div
                            className={`st-map-upload-zone ${mappingPrintPreview ? 'has-image' : ''}`}
                            onClick={() => !mappingPrintPreview && mapFileRef.current?.click()}
                            onDrop={(e) => { e.preventDefault(); handleMappingUpload(e.dataTransfer.files[0]); }}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            {mappingPrintPreview ? (
                                <>
                                    <div className="st-map-upload-icon" style={{ background: '#dcfce7', color: '#16a34a' }}>
                                        <I d="M5 13l4 4L19 7" s={24} />
                                    </div>
                                    <h3>Print uploaded successfully!</h3>
                                    <p>{mappingPrint?.file?.name || 'pattern.png'}</p>
                                </>
                            ) : (
                                <>
                                    <div className="st-map-upload-icon">
                                        <I d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" s={24} />
                                    </div>
                                    <h3>Drag & drop your image here</h3>
                                    <p>or</p>
                                    <button className="st-map-upload-btn" type="button">Upload Image</button>
                                    <p className="st-map-upload-formats">Supports: PNG, JPG, SVG (Max 50MB)</p>
                                </>
                            )}
                        </div>
                        <input ref={mapFileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.svg" hidden onChange={(e) => handleMappingUpload(e.target.files[0])} />

                        <div className="st-map-print-preview">
                            <div className="st-map-print-preview-title">Print Preview</div>
                            {mappingPrintPreview ? (
                                <>
                                    <img className="st-map-print-img" src={mappingPrintPreview} alt="Print Preview" />
                                    <div className="st-map-print-info">
                                        <div className="st-map-print-name">
                                            Print Name
                                            <span>{mappingPrint?.file?.name || 'pattern.png'}</span>
                                        </div>
                                        <button className="st-map-replace-btn" onClick={() => mapFileRef.current?.click()}>Replace</button>
                                    </div>
                                </>
                            ) : (
                                <div className="st-map-print-empty">
                                    <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={32} />
                                    <span>Upload a print to preview</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Step 2: Select Category */}
            {mappingStep >= 1 && (
                <div className="st-map-section">
                    <h2 className="st-map-section-title">Select Category</h2>
                    <p className="st-map-section-desc">Choose the category that best fits your print</p>
                    <div className="st-map-categories">
                        {MAPPING_CATEGORIES.map(cat => (
                            <div
                                key={cat.id}
                                className={`st-map-category ${mappingCategory === cat.id ? 'active' : ''}`}
                                onClick={() => { setMappingCategory(cat.id); setMappingSelectedProducts(new Set()); if (mappingStep < 2) setMappingStep(2); }}
                            >
                                <div className="st-map-category-icon"><I d={cat.icon} s={22} /></div>
                                <div className="st-map-category-name">{cat.label}</div>
                                <div className="st-map-category-desc">{cat.desc}</div>
                                <div className="st-map-category-check">✓</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Step 3: Choose Products */}
            {mappingStep >= 1 && (
                <div className="st-map-section">
                    <h2 className="st-map-section-title">Choose Products</h2>
                    <p className="st-map-section-desc">Select the products you want to map this print on</p>

                    <div className="st-map-products-header">
                        <div className="st-map-selected-count">{mappingSelectedProducts.size} product{mappingSelectedProducts.size !== 1 ? 's' : ''} selected</div>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <div className="st-map-products-search">
                                <I d="M21 21l-4.3-4.3M10 18a8 8 0 100-16 8 8 0 000 16z" s={16} />
                                <input placeholder="Search products..." value={mappingProductSearch} onChange={e => setMappingProductSearch(e.target.value)} />
                            </div>
                            {mappingSelectedProducts.size > 0 && (
                                <button className="st-map-clear-btn" onClick={() => setMappingSelectedProducts(new Set())}>Clear All</button>
                            )}
                        </div>
                    </div>

                    <div className="st-map-products-grid">
                        {filteredProducts.map(product => (
                            <div
                                key={product.id}
                                className={`st-map-product ${mappingSelectedProducts.has(product.id) ? 'selected' : ''}`}
                                onClick={() => { toggleMappingProduct(product.id); if (mappingStep < 3) setMappingStep(3); }}
                            >
                                <div className="st-map-product-check">
                                    <I d="M5 13l4 4L19 7" s={14} />
                                </div>
                                <img className="st-map-product-img" src={product.image} alt={product.name} />
                                <div className="st-map-product-name">{product.name}</div>
                            </div>
                        ))}
                        {filteredProducts.length === 0 && (
                            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                                No products available in this category yet.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Step 4: Map & Preview (results) */}
            {mappingStep >= 4 && mappingResults.length > 0 && (
                <div className="st-map-section">
                    <h2 className="st-map-section-title">Map Your Print</h2>
                    <p className="st-map-section-desc">AI-generated product mockups with your pattern</p>
                    <div className="st-map-results">
                        <div className="st-map-results-grid">
                            {mappingResults.map((result, idx) => (
                                <div key={idx} className="st-map-result-card">
                                    <img src={`${API}${result.mockupUrl}`} alt={result.productType} />
                                    <div className="st-map-result-info">
                                        <span className="st-map-result-name">{result.productType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                                        <a className="st-map-result-dl" href={`${API}${result.mockupUrl}`} download onClick={(e) => forceDownload(e, `${API}${result.mockupUrl}`)}>
                                            <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={14} />
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Loading state */}
            {isMappingGenerating && (
                <div className="st-map-section" style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="st-spinner" style={{ margin: '0 auto 1rem' }} />
                    <p style={{ fontWeight: 600, color: '#374151' }}>Generating AI mockups...</p>
                    <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>This may take 30-60 seconds per product</p>
                </div>
            )}

            {/* Footer */}
            <div className="st-map-footer">
                <div className="st-map-footer-left">
                    <button onClick={() => {
                        setMappingStep(1);
                        setMappingPrint(null);
                        setMappingPrintPreview(null);
                        setMappingSelectedProducts(new Set());
                        setMappingResults([]);
                        setMappingControls({ scale: 120, posX: 10, posY: -5, rotate: 0, flipH: false, flipV: false });
                    }}>Cancel</button>
                </div>
                <div className="st-map-footer-right">
                    <button className="st-map-draft-btn">Save as Draft</button>
                    <button
                        className="st-map-primary-btn"
                        disabled={!mappingPrint || mappingSelectedProducts.size === 0 || isMappingGenerating}
                        onClick={generateMockups}
                    >
                        {isMappingGenerating ? (
                            <><div className="st-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Generating...</>
                        ) : (
                            <>Map & Preview <I d="M5 12h14M12 5l7 7-7 7" s={16} /></>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
