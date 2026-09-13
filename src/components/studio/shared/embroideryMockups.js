/**
 * Embroidery Mockups reference data: which products take placement embroidery, where it sits on
 * each product, and a small suitability guide of technique by product by fabric.
 * Product ids match the Mappings product list (and /public/products/<id>.png).
 */

export const EMBROIDERY_PRODUCTS = [
    { id: 'saree', label: 'Saree', group: 'Apparel', zones: ['pallu', 'border', 'blouse piece', 'body'] },
    { id: 'dress', label: 'Dress', group: 'Apparel', zones: ['neckline', 'yoke', 'hem', 'sleeves'] },
    { id: 'kimono', label: 'Kimono', group: 'Apparel', zones: ['back panel', 'lapels', 'sleeves', 'hem'] },
    { id: 'skirt', label: 'Skirt', group: 'Apparel', zones: ['hem border', 'waistband', 'front panel'] },
    { id: 'tshirt', label: 'T-Shirt', group: 'Apparel', zones: ['chest', 'pocket', 'sleeve'] },
    { id: 'hoodie', label: 'Hoodie', group: 'Apparel', zones: ['chest', 'back', 'sleeve'] },
    { id: 'scarf', label: 'Scarf / Dupatta', group: 'Accessories', zones: ['ends', 'border', 'corner'] },
    { id: 'tote_bag', label: 'Tote Bag', group: 'Accessories', zones: ['front panel', 'top band'] },
    { id: 'cushion', label: 'Cushion', group: 'Home', zones: ['centre', 'border', 'corner'] },
    { id: 'pillow_cover', label: 'Pillow Cover', group: 'Home', zones: ['centre', 'edge border'] },
    { id: 'table_runner', label: 'Table Runner', group: 'Home', zones: ['ends', 'centre band', 'border'] },
    { id: 'napkin_set', label: 'Napkin', group: 'Home', zones: ['corner', 'edge'] },
    { id: 'throw_blanket', label: 'Throw', group: 'Home', zones: ['border', 'corner'] },
    { id: 'curtain', label: 'Curtain', group: 'Home', zones: ['hem border', 'leading edge'] },
    { id: 'bed_sheet', label: 'Bed Sheet', group: 'Home', zones: ['top border', 'edge'] },
];

export const EMBROIDERY_TECHNIQUES = [
    { id: 'thread', label: 'Thread embroidery' },
    { id: 'zari', label: 'Zari (metallic)' },
    { id: 'applique', label: 'Appliqué' },
    { id: 'sequin', label: 'Sequins & beads' },
    { id: 'mirror', label: 'Mirror work' },
];

export const EMBROIDERY_FABRICS = [
    { id: 'cotton', label: 'Cotton' },
    { id: 'silk', label: 'Silk' },
    { id: 'velvet', label: 'Velvet' },
    { id: 'linen', label: 'Linen' },
    { id: 'georgette', label: 'Georgette' },
    { id: 'denim', label: 'Denim' },
    { id: 'wool', label: 'Wool' },
    { id: 'jersey', label: 'Jersey knit' },
];

export const MOCKUP_BACKGROUNDS = ['studio', 'lifestyle', 'transparent', 'dark'];
export const MOCKUP_SHOTS = ['editorial', 'flat lay', 'close-up'];

/** Guidance rules. The first matching rule wins, so the specific warnings come first. */
const RULES = [
    { technique: 'zari', fabrics: ['jersey'], level: 'avoid', note: 'Metallic zari puckers stretch knits. Use a stabiliser or switch to thread embroidery.' },
    { technique: 'sequin', fabrics: ['jersey'], level: 'avoid', note: 'Sequins on stretch knits crack and pull. Consider a lined yoke.' },
    { technique: 'sequin', products: ['bed_sheet', 'napkin_set', 'cushion', 'pillow_cover', 'throw_blanket'], level: 'avoid', note: 'Hard embellishments are uncomfortable on items people lean or lie on.' },
    { technique: 'mirror', products: ['curtain', 'bed_sheet', 'tshirt', 'hoodie'], level: 'avoid', note: 'Mirror work is heavy. Keep it to cushions, bags, dupattas and hems.' },
    { technique: 'zari', fabrics: ['silk', 'velvet'], level: 'good', note: 'Classic pairing: zari sits beautifully on silk and velvet.' },
    { technique: 'zari', fabrics: ['cotton', 'linen'], level: 'ok', note: 'Fine for borders. Keep coverage light so the fabric does not stiffen.' },
    { technique: 'mirror', fabrics: ['velvet', 'georgette'], level: 'ok', note: 'Back the fabric so the mirror rings do not sag.' },
    { technique: 'applique', fabrics: ['cotton', 'denim', 'linen'], level: 'good', note: 'Appliqué loves firm wovens. Edges stay crisp.' },
    { technique: 'applique', fabrics: ['georgette', 'silk'], level: 'ok', note: 'Use a lightweight patch and a fine satin edge on sheer or slippery fabrics.' },
    { technique: 'thread', fabrics: ['velvet'], level: 'ok', note: 'Dense fill stitches sink into the pile. Prefer bolder satin stitches.' },
    { technique: 'thread', fabrics: ['georgette'], level: 'ok', note: 'Sheer fabric needs a stabiliser. Keep the design open.' },
];

export const SUITABILITY_LABELS = { good: 'Good match', ok: 'Works with care', avoid: 'Avoid' };

export function suitability(techniqueId, productId, fabricId) {
    const rule = RULES.find((candidate) => (
        candidate.technique === techniqueId
        && (!candidate.fabrics || candidate.fabrics.includes(fabricId))
        && (!candidate.products || candidate.products.includes(productId))
    ));
    if (rule) return { level: rule.level, label: SUITABILITY_LABELS[rule.level], note: rule.note };
    return { level: 'good', label: SUITABILITY_LABELS.good, note: 'No known issues for this combination.' };
}

export function productById(productId) {
    return EMBROIDERY_PRODUCTS.find((product) => product.id === productId) || null;
}
