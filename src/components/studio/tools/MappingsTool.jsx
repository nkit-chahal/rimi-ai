import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';
import { createPortal } from 'react-dom';
import { isImageFile } from '../shared/imageUpload';
import { useImageDropzone } from '../shared/useImageDropzone';

const CustomMappingCanvas = ({ imageUrl, onComplete, onCancel }) => {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushSize, setBrushSize] = useState(30);

    useEffect(() => {
        if (!imageUrl || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            // Draw original image as background (wait, mask should only contain white strokes on black bg, but we show the image to the user)
            // Actually, we should draw the image as a CSS background on the canvas container, and the canvas itself should just be the mask drawing layer!
            // This makes extracting the mask easier.
        };
        img.src = imageUrl;
    }, [imageUrl]);

    const startDraw = (e) => {
        const ctx = canvasRef.current.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        setIsDrawing(true);
    };

    const draw = (e) => {
        if (!isDrawing) return;
        const ctx = canvasRef.current.getContext('2d');
        ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; // White stroke for the mask
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
    };

    const stopDraw = () => {
        setIsDrawing(false);
    };

    const clearCanvas = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const saveMask = () => {
        // Create an offscreen canvas to generate the solid black/white mask
        const offscreen = document.createElement('canvas');
        const c = canvasRef.current;
        offscreen.width = c.width;
        offscreen.height = c.height;
        const ctx = offscreen.getContext('2d');
        // Fill black
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);
        // Draw the white strokes over it
        ctx.drawImage(c, 0, 0);

        onComplete(offscreen.toDataURL('image/png'));
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#1e1e2e', padding: '24px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '90vw', maxHeight: '90vh' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, color: 'white' }}>Paint Custom Mask</h3>
                    <button onClick={onCancel} style={{ background: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}><I d="M6 18L18 6M6 6l12 12" s={24} /></button>
                </div>
                <p style={{ margin: 0, color: '#a1a1aa', fontSize: '14px' }}>Brush over the area where you want the pattern to be applied.</p>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <label style={{ color: 'white', fontSize: '14px' }}>Brush Size: {brushSize}px</label>
                    <input type="range" min="5" max="100" value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} style={{ flex: 1 }} />
                    <button onClick={clearCanvas} style={{ background: '#3f3f46', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer' }}>Clear</button>
                </div>

                <div style={{ position: 'relative', overflow: 'auto', flex: 1, border: '1px solid #3f3f46', borderRadius: '8px', background: `url(${imageUrl})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }}>
                    <canvas
                        ref={canvasRef}
                        onMouseDown={startDraw}
                        onMouseMove={draw}
                        onMouseUp={stopDraw}
                        onMouseLeave={stopDraw}
                        style={{ cursor: 'crosshair', display: 'block', maxWidth: '100%', objectFit: 'contain' }}
                    />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button onClick={onCancel} style={{ background: 'transparent', color: 'white', border: '1px solid #52525b', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                    <button onClick={saveMask} style={{ background: '#6366f1', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Save Mask</button>
                </div>
            </div>
        </div>
    );
};


const isMappingFile = (file) => {
    if (!file) return false;
    if (isImageFile(file)) return true;
    return file.type === 'image/svg+xml' || file.name?.toLowerCase().endsWith('.svg');
};

export default function MappingsTool(props) {
    const { uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse, creditPricing, currentToken, onUploadPaste } = props;

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));

    const MAPPING_CATEGORIES = [
        { id: 'home', label: 'Home & Decor', desc: 'Bedding, cushions, curtains, rugs & more', icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z', color: '#6366f1' },
        { id: 'apparel', label: 'Apparel', desc: 'T-shirts, dresses, hoodies & fashion', icon: 'M20.38 3.46L16 2 12 5.5 8 2 3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47c.06.37.29.7.62.89L8 12.75V21h8v-8.25l4.52-2.7c.33-.19.56-.52.62-.89l.58-3.47a2 2 0 00-1.34-2.23z', color: '#ec4899' },
        { id: 'accessories', label: 'Accessories', desc: 'Bags, scarves, phone cases & lifestyle', icon: 'M20 7h-4V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v3H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM10 4h4v3h-4V4z', color: '#f59e0b' },
        { id: 'custom', label: 'Custom Canvas', desc: 'Upload any product & paint your own mask', icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z', color: '#10b981' },
    ];
    const MAPPING_PRODUCTS = {
        home: [
            { id: 'bed_sheet', name: 'Bed Sheet', image: '/products/bed_sheet.png' },
            { id: 'pillow_cover', name: 'Pillow Cover', image: '/products/pillow_cover.png' },
            { id: 'pillow_lumbar', name: 'Lumbar Pillow', image: '/products/pillow_lumbar.png' },
            { id: 'comforter', name: 'Comforter', image: '/products/comforter.png' },
            { id: 'cushion', name: 'Cushion', image: '/products/cushion.png' },
            { id: 'cushion_floor', name: 'Floor Cushion', image: '/products/cushion_floor.png' },
            { id: 'curtain', name: 'Curtain', image: '/products/curtain.png' },
            { id: 'tablecloth', name: 'Tablecloth', image: '/products/tablecloth.png' },
            { id: 'table_runner', name: 'Table Runner', image: '/products/table_runner.png' },
            { id: 'napkin_set', name: 'Napkin Set', image: '/products/napkin_set.png' },
            { id: 'throw_blanket', name: 'Throw Blanket', image: '/products/throw_blanket.png' },
            { id: 'duvet_cover', name: 'Duvet Cover', image: '/products/duvet_cover.png' },
            { id: 'sofa_upholstery', name: 'Sofa Upholstery', image: '/products/sofa_upholstery.png' },
            { id: 'wallpaper', name: 'Wallpaper', image: '/products/wallpaper.png' },
            { id: 'rug', name: 'Area Rug', image: '/products/rug.png' },
            { id: 'shower_curtain', name: 'Shower Curtain', image: '/products/shower_curtain.png' },
            { id: 'bath_towel', name: 'Bath Towel', image: '/products/bath_towel.png' },
            { id: 'lamp_shade', name: 'Lamp Shade', image: '/products/lamp_shade.png' },
        ],
        apparel: [
            { id: 'tshirt', name: 'T-Shirt', image: '/products/tshirt.png' },
            { id: 'hoodie', name: 'Hoodie', image: '/products/hoodie.png' },
            { id: 'dress', name: 'Dress', image: '/products/dress.png' },
            { id: 'saree', name: 'Saree', image: '/products/saree.png' },
            { id: 'kimono', name: 'Kimono', image: '/products/kimono.png' },
            { id: 'leggings', name: 'Leggings', image: '/products/leggings.png' },
            { id: 'skirt', name: 'Skirt', image: '/products/skirt.png' },
        ],
        accessories: [
            { id: 'tote_bag', name: 'Tote Bag', image: '/products/tote_bag.png' },
            { id: 'backpack', name: 'Backpack', image: '/products/backpack.png' },
            { id: 'phone_case', name: 'Phone Case', image: '/products/phone_case.png' },
            { id: 'scarf', name: 'Scarf', image: '/products/scarf.png' },
            { id: 'umbrella', name: 'Umbrella', image: '/products/umbrella.png' },
            { id: 'socks', name: 'Socks', image: '/products/socks.png' },
        ],
        custom: [
            { id: 'custom_product', name: 'Custom Product Mapping', image: null },
        ]
    };

    const [mappingStep, setMappingStep] = useState(1);
    const [mappingPrint, setMappingPrint] = useState(null); // { file, filename, url }
    const [mappingPrintPreview, setMappingPrintPreview] = useState(null);
    const [mappingCategory, setMappingCategory] = useState('home');
    const [mappingSelectedProducts, setMappingSelectedProducts] = useState(new Set());
    const [mappingResults, setMappingResults] = useState([]);
    const [isMappingGenerating, setIsMappingGenerating] = useState(false);
    const [mappingProductSearch, setMappingProductSearch] = useState('');

    // Custom Mapping Editor States
    const [mappingBackground, setMappingBackground] = useState('studio');
    const [mappingShotStyle, setMappingShotStyle] = useState('editorial');
    const [mappingFabricTexture, setMappingFabricTexture] = useState('cotton');
    const [mappingCustomPrompt, setMappingCustomPrompt] = useState('');
    const [mappingCustomReference, setMappingCustomReference] = useState(null); // The uploaded image File
    const [mappingCustomReferencePreview, setMappingCustomReferencePreview] = useState(null); // The uploaded image URL
    const [mappingCustomMask, setMappingCustomMask] = useState(null); // The drawn mask URL
    const [isCanvasOpen, setIsCanvasOpen] = useState(false);

    const handleMappingUpload = (file) => {
        if (!file) return;
        setMappingPrintPreview(URL.createObjectURL(file));
        const fd = new FormData();
        fd.append('image', file);
        fetch(`${API}/api/upload`, { method: 'POST', body: fd })
            .then(r => r.json())
            .then(d => {
                if (d.success) setMappingPrint({ file, filename: d.filename, url: d.url });
            })
            .catch(() => setError('Upload failed'));
    };

    const { rootProps, pasteProps, inputProps, openFilePicker, isDrag } = useImageDropzone({
        onFile: handleMappingUpload,
        onInvalidFile: setError,
        onPasteSuccess: onUploadPaste,
        accept: '.jpg,.jpeg,.png,.webp,.svg',
        isValidFile: isMappingFile,
    });

    const toggleMappingProduct = (productId) => {
        setMappingSelectedProducts(prev => {
            const next = new Set(prev);
            if (next.has(productId)) next.delete(productId); else next.add(productId);
            return next;
        });
    };

    const generateMockups = async () => {
        if (!mappingPrint?.filename || mappingSelectedProducts.size === 0) return;
        const requiredCredits = mappingSelectedProducts.size * (creditPricing.mappings || 148);
        if (userRemainingCredits < requiredCredits) {
            setError(`Insufficient credits. Mockup generation needs ${requiredCredits} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }
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
                    customPrompt: mappingCustomPrompt,
                    background: mappingBackground,
                    shotStyle: mappingShotStyle,
                    fabricTexture: mappingFabricTexture,
                    productReferenceDataUri: mappingCustomReferencePreview,
                    maskDataUri: mappingCustomMask,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await r.json();
            if (d.success && d.mockups) {
                setMappingResults(d.mockups);
                setMappingStep(4);
                setIsMappingGenerating(false);
                updateCreditsFromResponse(d);
                return { url: d.mockups[0]?.mockupUrl, urls: d.mockups.map(m => m.mockupUrl) };
            } else {
                setIsMappingGenerating(false);
                throw new Error(d.error || 'Failed to generate mockups');
            }
        };

        addBgTask('mappings', `Product Mockup: ${mappingSelectedProducts.size} item(s)`, mappingPrint.filename, trigger);
    };
    // ===== END MAPPINGS =====

    // ===== COLORWAYS FUNCTIONS =====


    const STEPS = ['Upload Print', 'Select Category', 'Choose Products', 'Map & Preview'];
    const currentProducts = MAPPING_PRODUCTS[mappingCategory] || [];
    const filteredProducts = mappingProductSearch
        ? currentProducts.filter(p => p.name.toLowerCase().includes(mappingProductSearch.toLowerCase()))
        : currentProducts;
    const mappingCreditCost = mappingSelectedProducts.size * (creditPricing.mappings || 148);
    const hasEnoughMappingCredits = userRemainingCredits >= mappingCreditCost;

    return (
        <div {...pasteProps} className="st-map-wizard">
            {/* Step indicator */}
            <div className="st-map-steps">
                {STEPS.map((label, i) => (
                    <React.Fragment key={i}>
                        <div
                            className={`st-map-step ${mappingStep === i + 1 ? 'active' : ''} ${mappingStep > i + 1 ? 'completed' : ''}`}
                            onClick={() => { if (i + 1 < mappingStep || (i + 1 === 2 && mappingPrint)) setMappingStep(i + 1); }}
                        >
                            <div className="st-map-step-num">
                                {mappingStep > i + 1 ? <I d="M5 13l4 4L19 7" s={14} /> : i + 1}
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
            {mappingStep === 1 && (
                <div className="st-map-section">
                    <h2 className="st-map-section-title">Upload Your Print</h2>
                    <p className="st-map-section-desc">Upload a high quality print or pattern</p>
                    <div className="st-map-upload-row">
                        <div
                            className={`st-map-upload-zone ${mappingPrintPreview ? 'has-image' : ''} ${isDrag ? 'dragging' : ''}`}
                            {...rootProps}
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
                                    <h3>Drag, paste, or drop your image here</h3>
                                    <p>or</p>
                                    <button className="st-map-upload-btn" type="button" onClick={(e) => { e.stopPropagation(); openFilePicker(); }}>Upload Image</button>
                                    <p className="st-map-upload-formats">Supports: PNG, JPG, WEBP, SVG (Max 50MB)</p>
                                </>
                            )}
                        </div>
                        <input {...inputProps} />

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
                                        <button className="st-map-replace-btn" onClick={() => openFilePicker()}>Replace</button>
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
            {mappingStep === 2 && (
                <div className="st-map-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '360px' }}>
                    <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                        <h2 className="st-map-section-title" style={{ fontSize: '1.15rem' }}>What are you creating?</h2>
                        <p className="st-map-section-desc" style={{ margin: 0 }}>Choose a product category to see available mockup templates</p>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', width: '100%', maxWidth: '720px' }}>
                        {MAPPING_CATEGORIES.map(cat => {
                            const active = mappingCategory === cat.id;
                            const productCount = (MAPPING_PRODUCTS[cat.id] || []).length;
                            return (
                                <div
                                    key={cat.id}
                                    onClick={() => { setMappingCategory(cat.id); setMappingSelectedProducts(new Set()); }}
                                    style={{
                                        border: active ? `2px solid ${cat.color}` : '2px solid #e5e7eb',
                                        borderRadius: '16px', padding: '20px 16px', cursor: 'pointer',
                                        background: active ? `${cat.color}08` : '#fff',
                                        transition: 'all 0.25s ease', position: 'relative',
                                        textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center',
                                        boxShadow: active ? `0 4px 20px ${cat.color}15` : '0 1px 3px rgba(0,0,0,0.04)',
                                    }}
                                >
                                    {active && (
                                        <div style={{ position: 'absolute', top: '10px', right: '10px', width: '22px', height: '22px', borderRadius: '50%', background: cat.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <I d="M5 13l4 4L19 7" s={12} style={{ color: '#fff' }} />
                                        </div>
                                    )}
                                    <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: active ? `${cat.color}18` : '#f3f4f6', color: active ? cat.color : '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px', transition: 'all 0.25s ease' }}>
                                        <I d={cat.icon} s={24} />
                                    </div>
                                    <div style={{ fontSize: '0.88rem', fontWeight: 750, color: '#1f2937', marginBottom: '4px' }}>{cat.label}</div>
                                    <div style={{ fontSize: '0.7rem', color: '#6b7280', lineHeight: 1.4, marginBottom: '10px' }}>{cat.desc}</div>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '3px 10px', borderRadius: '8px', background: active ? `${cat.color}12` : '#f3f4f6', color: active ? cat.color : '#9ca3af' }}>
                                        {cat.id === 'custom' ? 'Unlimited' : `${productCount} products`}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Step 3: Choose Products or Customizer */}
            {mappingStep === 3 && (
                <div className="st-map-section">
                    <h2 className="st-map-section-title">{mappingCategory === 'custom' ? 'Custom Mask & Settings' : 'Choose Products'}</h2>
                    <p className="st-map-section-desc">{mappingCategory === 'custom' ? 'Upload a product photo, paint a mask, and adjust settings' : 'Select the products you want to map this print on'}</p>

                    {mappingCategory !== 'custom' ? (
                        <>
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
                                        onClick={() => { toggleMappingProduct(product.id); }}
                                        style={{ overflow: 'hidden' }}
                                    >
                                        <div className="st-map-product-check">
                                            <I d="M5 13l4 4L19 7" s={14} />
                                        </div>
                                        <div className="st-map-product-image-container" style={{ width: '100%', height: '120px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {product.image ? (
                                                <img src={product.image} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                            ) : (
                                                <div className="st-map-product-icon">
                                                    <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" s={28} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="st-map-product-name">{product.name}</div>
                                    </div>
                                ))}
                                {filteredProducts.length === 0 && (
                                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                                        No products available in this category yet.
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="st-map-custom-panel">
                            <div className="st-map-custom-grid">
                                <div className="st-map-custom-block">
                                    <label className="st-map-field-label">1. Reference image</label>
                                    <div
                                        className={`st-map-custom-upload ${mappingCustomReferencePreview ? 'has-image' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => {
                                            const input = document.createElement('input');
                                            input.type = 'file';
                                            input.accept = 'image/*';
                                            input.onchange = (e) => {
                                                const file = e.target.files[0];
                                                if (file) {
                                                    setMappingCustomReference(file);
                                                    const r = new FileReader();
                                                    r.onload = (ev) => {
                                                        setMappingCustomReferencePreview(ev.target.result);
                                                        setMappingCustomMask(null);
                                                        const newSet = new Set(mappingSelectedProducts);
                                                        newSet.add('custom_product');
                                                        setMappingSelectedProducts(newSet);
                                                    };
                                                    r.readAsDataURL(file);
                                                }
                                            };
                                            input.click();
                                        }}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}
                                    >
                                        {mappingCustomReferencePreview ? (
                                            <>
                                                <img src={mappingCustomReferencePreview} alt="Product reference" />
                                                <span>Click to replace</span>
                                            </>
                                        ) : (
                                            <>
                                                <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={22} />
                                                <span>Upload product photo</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="st-map-custom-block">
                                    <label className="st-map-field-label">2. Target area mask</label>
                                    <button
                                        type="button"
                                        className="st-map-mask-btn"
                                        onClick={() => { if (mappingCustomReferencePreview) setIsCanvasOpen(true); else setError('Upload reference image first'); }}
                                    >
                                        <I d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" s={18} />
                                        {mappingCustomMask ? 'Edit painted mask' : 'Paint masking area'}
                                    </button>
                                    {mappingCustomMask && (
                                        <p className="st-map-mask-applied">
                                            <I d="M5 13l4 4L19 7" s={14} />
                                            Mask applied — pattern will fill this region
                                        </p>
                                    )}
                                </div>

                                <div className="st-map-custom-block st-map-custom-block-wide">
                                    <label className="st-map-field-label" htmlFor="mapping-custom-prompt">3. Describe product (AI prompt)</label>
                                    <div className="st-map-chat-box">
                                        <I d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.7 1.7-1.7h2c3.1 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2z" s={16} />
                                        <textarea
                                            id="mapping-custom-prompt"
                                            placeholder="e.g. A modern living room sofa with natural sunlight"
                                            value={mappingCustomPrompt}
                                            onChange={(e) => setMappingCustomPrompt(e.target.value)}
                                            rows={3}
                                        />
                                    </div>
                                </div>

                                <div className="st-map-custom-block">
                                    <label className="st-map-field-label" htmlFor="mapping-background">Background</label>
                                    <select
                                        id="mapping-background"
                                        className="st-map-select"
                                        value={mappingBackground}
                                        onChange={(e) => setMappingBackground(e.target.value)}
                                    >
                                        <option value="studio">Studio lighting (clean)</option>
                                        <option value="lifestyle">Lifestyle / indoor</option>
                                        <option value="outdoor">Outdoor / natural</option>
                                        <option value="minimal">Minimalist</option>
                                    </select>
                                </div>

                                <div className="st-map-custom-block">
                                    <label className="st-map-field-label" htmlFor="mapping-fabric">Fabric material</label>
                                    <select
                                        id="mapping-fabric"
                                        className="st-map-select"
                                        value={mappingFabricTexture}
                                        onChange={(e) => setMappingFabricTexture(e.target.value)}
                                    >
                                        <option value="cotton">Cotton / matte</option>
                                        <option value="silk">Silk / satin (glossy)</option>
                                        <option value="linen">Linen (textured)</option>
                                        <option value="velvet">Velvet (plush)</option>
                                        <option value="canvas">Canvas / heavy</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Step 4: Map & Preview (results) */}
            {mappingStep === 4 && (
                <div className="st-map-section">
                    <h2 className="st-map-section-title">Map Your Print</h2>
                    <p className="st-map-section-desc">AI-generated product mockups with your pattern</p>

                    {/* Loading state */}
                    {isMappingGenerating && (
                        <div style={{ textAlign: 'center', padding: '3.5rem 2rem' }}>
                            <div className="st-ai-processing" style={{ margin: '0 auto' }}>
                                <div className="st-ai-sparkle-container">
                                    <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={28} />
                                    <div className="st-ai-ring" />
                                    <div className="st-ai-ring" />
                                    <div className="st-ai-ring" />
                                </div>
                            </div>
                            <p style={{ fontWeight: 800, color: '#111827', fontSize: '1.05rem', marginTop: '1.5rem', letterSpacing: '-0.02em' }}>Generating AI Mockups</p>
                            <p style={{ fontSize: '0.85rem', color: '#6b7280', fontWeight: 500, marginTop: '0.35rem' }}>Mapping your pattern onto selected products — 30-60s per product</p>
                        </div>
                    )}

                    {mappingResults.length > 0 && (
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
                    )}

                    {!isMappingGenerating && mappingResults.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
                            <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" s={40} />
                            <p style={{ marginTop: '1rem', fontWeight: 600, color: '#6b7280' }}>Click "Generate Mockups" to create your product mockups</p>
                        </div>
                    )}
                </div>
            )}

            {/* Custom Canvas Modal */}
            {isCanvasOpen && mappingCustomReferencePreview && (
                <CustomMappingCanvas
                    imageUrl={mappingCustomReferencePreview}
                    onCancel={() => setIsCanvasOpen(false)}
                    onComplete={(maskUrl) => {
                        setMappingCustomMask(maskUrl);
                        setIsCanvasOpen(false);
                    }}
                />
            )}

            {/* Footer with Back / Next navigation */}
            <div className="st-map-footer">
                <div className="st-map-footer-left">
                    {mappingStep > 1 && (
                        <button onClick={() => setMappingStep(s => s - 1)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <I d="M19 12H5M12 19l-7-7 7-7" s={16} /> Back
                        </button>
                    )}
                    <button onClick={() => {
                        setMappingStep(1);
                        setMappingPrint(null);
                        setMappingPrintPreview(null);
                        setMappingSelectedProducts(new Set());
                        setMappingResults([]);
                    }} style={{ color: '#9ca3af' }}>Reset</button>
                </div>
                <div className="st-map-footer-right">
                    {mappingStep < 4 ? (
                        <button
                            className="st-map-primary-btn"
                            disabled={
                                (mappingStep === 1 && !mappingPrint) ||
                                (mappingStep === 2 && !mappingCategory) ||
                                (mappingStep === 3 && mappingSelectedProducts.size === 0)
                            }
                            onClick={() => setMappingStep(s => s + 1)}
                        >
                            {mappingStep === 3 ? 'Continue to Generate' : 'Next Step'} <I d="M5 12h14M12 5l7 7-7 7" s={16} />
                        </button>
                    ) : (
                        <button
                            className={`st-map-primary-btn ${!hasEnoughMappingCredits ? 'insufficient-credits' : ''}`}
                            disabled={!mappingPrint || mappingSelectedProducts.size === 0 || isMappingGenerating || !hasEnoughMappingCredits}
                            onClick={generateMockups}
                            title={!hasEnoughMappingCredits ? `Need ${mappingCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Generate mockups'}
                        >
                            {isMappingGenerating ? (
                                <><div className="st-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Generating...</>
                            ) : !hasEnoughMappingCredits ? (
                                <>Need {mappingCreditCost} credits</>
                            ) : (
                                <><I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={16} /> Generate Mockups ({mappingSelectedProducts.size})</>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

}
