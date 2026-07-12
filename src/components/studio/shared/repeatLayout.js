/**
 * Pure fabric/tile layout math for Repeat Set preview + export.
 * Fabric width drives how many full tiles fit across; export never
 * silently exceeds fabric by ceiling a fractional fit (e.g. 54/12 → 4, not 5).
 */

const FABRIC_PREVIEW_PX_DEFAULT = 960;

/**
 * Integer tile count for an export sheet that fits within fabric width.
 * Oversized tiles (wider than fabric) still use a 2×2 sample sheet.
 */
export function calcExportGrid(fabricWidth, tileWidth) {
    const fw = Number(fabricWidth) || 54;
    const tw = Math.max(Number(tileWidth) || 0.5, 0.5);
    if (tw > fw) return 2;
    const full = Math.floor(fw / tw);
    if (full >= 2) return Math.min(8, full);
    return Math.max(1, full);
}

/**
 * @param {{ fabricWidth: number, tileWidth: number, tileHeight?: number, dpi?: number, fabricPreviewPx?: number }} opts
 */
export function calcRepeatLayoutMetrics({
    fabricWidth,
    tileWidth,
    tileHeight,
    dpi = 300,
    fabricPreviewPx = FABRIC_PREVIEW_PX_DEFAULT,
} = {}) {
    const fabW = Number(fabricWidth) || 54;
    const rptW = Math.max(Number(tileWidth) || 0.5, 0.5);
    const rptH = Math.max(Number(tileHeight ?? tileWidth) || 0.5, 0.5);
    const exportDpi = Number(dpi) || 300;

    const repeatsAcross = fabW / rptW;
    const fullRepeatsAcross = Math.floor(repeatsAcross);
    const tileWiderThanFabric = rptW > fabW;
    const exactFit = !tileWiderThanFabric && Math.abs(repeatsAcross - Math.round(repeatsAcross)) < 0.01;

    const coverage = tileWiderThanFabric
        ? 100
        : (fullRepeatsAcross * rptW) / Math.max(fabW, 1) * 100;

    const exportGrid = calcExportGrid(fabW, rptW);
    // Ceil only for yardage remainder peek (e.g. 4.5 → show 5th partial past the
    // fabric guide). Never force min 2×3 — that made engineered 48″ on 60″ look
    // like a wall of tiles while export is correctly 1×1.
    const tilesAcrossCeil = Math.ceil(repeatsAcross);
    const maxPreviewCols = rptW <= 2 ? 36 : rptW <= 4 ? 24 : rptW <= 8 ? 18 : 12;
    const useYardageRemainderPeek = !exactFit && fullRepeatsAcross >= 2;

    const previewCols = tileWiderThanFabric
        ? 1
        : Math.min(
            maxPreviewCols,
            Math.max(
                1,
                useYardageRemainderPeek ? tilesAcrossCeil : Math.max(fullRepeatsAcross, 1),
            ),
        );
    const previewRows = tileWiderThanFabric
        ? 2
        : Math.min(
            8,
            previewCols <= 1
                ? 2
                : Math.max(3, Math.ceil(previewCols / 4)),
        );

    const tileDisplayW = tileWiderThanFabric
        ? fabricPreviewPx
        : fabricPreviewPx / repeatsAcross;
    const tileDisplayH = tileDisplayW * (rptH / rptW);
    // Single-tile / engineered fabric view: canvas width = fabric guide so a
    // fractional remainder (1.25 across) shows as a clipped peek, not a 2nd full column.
    const fabricLockedPreview = !tileWiderThanFabric && fullRepeatsAcross < 2;
    const canvasPxW = fabricLockedPreview
        ? fabricPreviewPx
        : Math.round(tileDisplayW * previewCols);
    const canvasPxH = Math.round(tileDisplayH * previewRows);

    const tilePxW = Math.round(rptW * exportDpi);
    const tilePxH = Math.round(rptH * exportDpi);
    const sheetPxW = tilePxW * exportGrid;
    const sheetPxH = tilePxH * exportGrid;
    const sheetInW = (exportGrid * rptW).toFixed(1);
    const sheetInH = (exportGrid * rptH).toFixed(1);

    const repeatsLabel = tileWiderThanFabric
        ? `Partial (${repeatsAcross.toFixed(2)} tile fits)`
        : exactFit
            ? `${Math.round(repeatsAcross)} across fabric`
            : `${fullRepeatsAcross} full (${repeatsAcross.toFixed(2)} across)`;

    const gridLabel = fabricLockedPreview
        ? `${exportGrid}×${exportGrid} export · fabric view`
        : `${previewCols}×${previewRows} on canvas`;

    let gridNote = '';
    if (!tileWiderThanFabric) {
        if (fabricLockedPreview && !exactFit) {
            gridNote = `${repeatsAcross.toFixed(2)} across ${fabW}″ · ${fullRepeatsAcross} full fit`;
        } else if (previewCols < tilesAcrossCeil && !fabricLockedPreview) {
            gridNote = `Full fabric = ${repeatsAcross.toFixed(2)} tiles across ${fabW}″`;
        } else if (exactFit) {
            gridNote = `Matches ${Math.round(repeatsAcross)} tiles across ${fabW}″`;
        } else if (previewCols > fullRepeatsAcross) {
            gridNote = `Preview padded; ${fullRepeatsAcross} full fit in ${fabW}″`;
        } else {
            gridNote = `${fullRepeatsAcross} full tiles fit across ${fabW}″`;
        }
    }

    return {
        fabricPreviewPx,
        repeatsAcross,
        fullRepeatsAcross,
        tilesAcrossCeil,
        tileWiderThanFabric,
        exactFit,
        fabricLockedPreview,
        coverage,
        exportGrid,
        previewCols,
        previewRows,
        tileDisplayW,
        tileDisplayH,
        canvasPxW,
        canvasPxH,
        tilePxW,
        tilePxH,
        sheetPxW,
        sheetPxH,
        sheetInW,
        sheetInH,
        repeatsLabel,
        gridLabel,
        gridNote,
    };
}
