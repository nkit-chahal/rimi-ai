import os
import re

with open('studio_dump.txt', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def get_lines(start, end):
    return "".join(lines[start-1:end])

destructure_block = """    const {
        tool, setTool, preview, setPreview, uploaded, setUploaded, activeProject,
        isEnh, extractDesign, isSeamless, generateSeamless,
        isVec, vecIsolate, setVecIsolate, vectorize, vecUrl,
        isUpscaling, upscaleFactor, setUpscaleFactor, upscale, upscaleUrl,
        controls, updateControls, createRepeat, isRepeat, renderVariations,
        prompt, setPrompt, generate, isGen, generatedVariations,
        isDesc, descImg, handleUpload, handlePreUpload, fileRef,
        layersList, selectedLayerId, isImageLayering, imageLayersNumLayers, setImageLayersNumLayers,
        layerEditPrompt, setLayerEditPrompt, editType, setEditType, isProcessingAI,
        handleEditLayer, imageLayersResults, isImageLayersFullscreen, setIsImageLayersFullscreen,
        qwenLayerDemoActions, applyQwenLayerDemo, applyCanvasTransform,
        resetLayersToBase, layerCanvasZoom, setImageLayerZoom, resetImageLayerView,
        isLayerMaskMode, setIsLayerMaskMode, layerMaskBrushSize, setLayerMaskBrushSize,
        clearLayerMask, handleInpaintLayer, isInpaintingLayer, recursiveLayerCount,
        setRecursiveLayerCount, handleRecursiveDecompose, handleComposeLayers, isExportingLayers,
        fabricCanvasRef, aiProcessingText, layerDragState, setLayerDragState, reorderLayerStack,
        selectLayerFromPanel, toggleLayerVisibility, toggleLayerLock,
        brandPalettesLoading, brandPalettes, deleteBrandPalette, handleDecomposeLayers,
        dashboardTab, setDashboardTab, savedProfiles, pipelineSteps, pipelineRunning,
        isDraggingOver, setIsDraggingOver, selectedTemplate, selectTemplate, addPipelineStep,
        deleteProfile, runProfile, updateStepSetting, removePipelineStep, savePipelineProfile,
        runPipeline, pipelineFile, PIPELINE_TEMPLATES, STEP_TYPES, pipelineCurrentStep, pipelinePreview,
        pipelineRuns, PIPELINE_CATEGORIES, pipelineName, setPipelineName,
        exportsList, isExporting, enhUrl, seamlessUrl, isDrag, setIsDrag,
        user, forceDownload
    } = props;
"""

os.makedirs('src/components/studio/tools', exist_ok=True)

def wrap_component(name, controls_range, canvas_range, extra=""):
    controls_code = get_lines(controls_range[0], controls_range[1]) if controls_range else ""
    canvas_code = get_lines(canvas_range[0], canvas_range[1]) if canvas_range else ""
    
    # Strip the leading `if (tool === '...') { return (`
    controls_code = re.sub(r"^\s*if\s*\(tool\s*===\s*'[a-z\-]+'\)\s*\{\s*return\s*\(", "", controls_code)
    controls_code = re.sub(r"^\s*if\s*\(tool\s*===\s*'[a-z\-]+'\)\s*return\s*\(", "", controls_code)
    # Strip the trailing `); }` or `);`
    controls_code = re.sub(r"\);\s*\}\s*$", "", controls_code)
    controls_code = re.sub(r"\);\s*$", "", controls_code)

    # Some canvas blocks define a loading variable
    canvas_code = re.sub(r"^\s*if\s*\(tool\s*===\s*'[a-z\-]+'\)\s*\{\s*const[^=]+=[^;]+;\s*return\s*\(", "", canvas_code)
    canvas_code = re.sub(r"^\s*if\s*\(tool\s*===\s*'[a-z\-]+'\)\s*\{\s*return\s*\(", "", canvas_code)
    canvas_code = re.sub(r"^\s*if\s*\(tool\s*===\s*'[a-z\-]+'\)\s*return\s*\(", "", canvas_code)
    canvas_code = re.sub(r"\);\s*\}\s*$", "", canvas_code)
    canvas_code = re.sub(r"\);\s*$", "", canvas_code)

    content = f"""import React, {{ useState, useEffect, useRef }} from 'react';
import {{ I }} from '../../shared/StudioIcons';
import {{ API }} from '../../shared/helpers';

export default function {name}(props) {{
{destructure_block}
    {extra}
    return (
        <>
{controls_code}
{canvas_code}
        </>
    );
}}
"""
    with open(f'src/components/studio/tools/{name}.jsx', 'w', encoding='utf-8') as f:
        f.write(content)

# 2. DashboardTool
wrap_component("DashboardTool", None, (4686, 4874))

# 3. ExportsTool
wrap_component("ExportsTool", None, (4922, 5258))

# 4. PatternTool (add loading const)
wrap_component("PatternTool", (3172, 3212), (5260, 5347), "const loading = isEnh;")

# 5. SeamlessTool
wrap_component("SeamlessTool", (3100, 3171), (5349, 5420), "const loading = isSeamless;")

# 6. LibraryTool
wrap_component("LibraryTool", None, (5422, 5532))

# 7. ImageLayersTool
wrap_component("ImageLayersTool", (3046, 3099), (5534, 5791))

# 8. VectorizeTool (needs special handling because it combines two if-statements in controls)
vectorize_controls = get_lines(3025, 3045)
vectorize_canvas = get_lines(5793, 5820)
vec_content = f"""import React, {{ useState }} from 'react';
import {{ I }} from '../../shared/StudioIcons';
import {{ API }} from '../../shared/helpers';

export default function VectorizeTool(props) {{
{destructure_block}
    const resultUrl = tool === 'vectorize' ? vecUrl : upscaleUrl;
    const loading = tool === 'vectorize' ? isVec : isUpscaling;
    return (
        <>
{{props.tool === 'vectorize' ? (
{get_lines(3026, 3032)}
) : (
{get_lines(3035, 3044)}
)}}
{get_lines(5796, 5819)}
        </>
    );
}}
"""
with open('src/components/studio/tools/VectorizeTool.jsx', 'w', encoding='utf-8') as f:
    f.write(vec_content)

# 10. InspireTool
wrap_component("InspireTool", (2962, 3024), (5821, 5918))

print("Done")
