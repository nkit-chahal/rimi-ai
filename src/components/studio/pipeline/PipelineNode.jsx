import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { I } from '../shared/StudioIcons';
import { getNodeDef, getNodeCost } from './pipelineRegistry';

function PipelineNode({ data, selected }) {
    const def = getNodeDef(data.nodeType);
    if (!def) return null;

    const cost = getNodeCost(data.nodeType, data.creditPricing || {});
    const preview = data.previewUrl || data.resultUrl;
    const isInput = data.nodeType === 'imageInput';
    const isExport = data.nodeType === 'export';
    const status = data.status || 'pending';

    return (
        <div className={`st-pipeline-node ${status} ${selected ? 'selected' : ''}`}>
            {!isInput && (
                <Handle type="target" position={Position.Left} className="st-pipeline-handle" />
            )}

            <div className="st-pipeline-node-head">
                <div className="st-pipeline-node-icon">
                    <I d={def.icon} s={16} />
                </div>
                <div className="st-pipeline-node-title">
                    <strong>{def.label}</strong>
                    {cost > 0 && <span className="st-pipeline-node-cost">{cost} cr</span>}
                </div>
                {status === 'running' && <div className="st-pipeline-node-spinner" />}
                {status === 'done' && <span className="st-pipeline-node-badge done"><I d="M5 13l4 4L19 7" s={12} /></span>}
                {status === 'error' && <span className="st-pipeline-node-badge error">!</span>}
            </div>

            <div className="st-pipeline-node-preview">
                {preview ? (
                    <img src={preview} alt="" />
                ) : (
                    <div className="st-pipeline-node-placeholder">
                        <I d={def.icon} s={28} />
                        <span>{def.desc}</span>
                    </div>
                )}
            </div>

            {isInput && (
                <div className="st-pipeline-node-actions">
                    <button type="button" className="st-pipeline-node-btn" onClick={data.onUpload}>
                        {data.filename ? 'Replace image' : 'Upload image'}
                    </button>
                </div>
            )}

            {!isInput && !isExport && (
                <div className="st-pipeline-node-settings">
                    {data.nodeType === 'repeat' && (
                        <select
                            value={data.settings?.gridSize || 3}
                            onChange={(e) => data.onSettingChange?.('gridSize', parseInt(e.target.value, 10))}
                        >
                            <option value={2}>2×2</option>
                            <option value={3}>3×3</option>
                            <option value={4}>4×4</option>
                        </select>
                    )}
                    {data.nodeType === 'upscale' && (
                        <select
                            value={data.settings?.upscaleFactor || 'x4'}
                            onChange={(e) => data.onSettingChange?.('upscaleFactor', e.target.value)}
                        >
                            <option value="x2">2×</option>
                            <option value="x4">4×</option>
                        </select>
                    )}
                    {data.nodeType === 'mappings' && (
                        <select
                            value={data.settings?.productType || 'tshirt'}
                            onChange={(e) => data.onSettingChange?.('productType', e.target.value)}
                        >
                            <option value="tshirt">T-Shirt</option>
                            <option value="dress">Dress</option>
                            <option value="hoodie">Hoodie</option>
                        </select>
                    )}
                    {data.nodeType === 'imagelayers' && (
                        <select
                            value={data.settings?.numLayers || 4}
                            onChange={(e) => data.onSettingChange?.('numLayers', parseInt(e.target.value, 10))}
                        >
                            <option value={2}>2 layers</option>
                            <option value={4}>4 layers</option>
                            <option value={6}>6 layers</option>
                        </select>
                    )}
                </div>
            )}

            {!isInput && (
                <div className="st-pipeline-node-actions">
                    <button
                        type="button"
                        className="st-pipeline-node-run"
                        onClick={data.onRun}
                        disabled={data.isRunning}
                    >
                        {status === 'running' ? 'Running…' : 'Run'}
                    </button>
                </div>
            )}

            {data.error && <p className="st-pipeline-node-error">{data.error}</p>}

            {!isExport && (
                <Handle type="source" position={Position.Right} className="st-pipeline-handle" />
            )}
        </div>
    );
}

export default memo(PipelineNode);
