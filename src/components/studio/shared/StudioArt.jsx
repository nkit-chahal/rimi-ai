/**
 * Decorative artwork for the studio picker cards.
 * Every piece is presentational: the card text carries the meaning, so the art is hidden from
 * assistive tech and never needs alt text. Print uses real textile swatches; Embroidery and
 * Woven are drawn as SVG because no photography exists for them yet.
 */

const PRINT_PALETTE = ['#e8737a', '#f4b8b4', '#f7e8d8', '#9fb894', '#5f8a6a'];

export function PrintArt() {
    return (
        <div className="ss-art ss-art-print" aria-hidden="true">
            <img
                className="ss-art-swatch ss-art-swatch-back"
                src="/studio/print-geometric.webp"
                alt=""
                width="640"
                height="640"
                decoding="sync"
                loading="eager"
                fetchPriority="high"
            />
            <div className="ss-art-front-box">
                <img
                    className="ss-art-swatch ss-art-swatch-front"
                    src="/studio/print-floral.webp"
                    alt=""
                    width="640"
                    height="640"
                    decoding="sync"
                    loading="eager"
                    fetchPriority="high"
                />
                <span className="ss-art-grid" />
            </div>
            <ul className="ss-art-palette">
                {PRINT_PALETTE.map((hex) => <li key={hex} style={{ background: hex }} />)}
            </ul>
        </div>
    );
}

const PETAL_ANGLES = [0, 60, 120, 180, 240, 300];
const KNOT_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const THREAD_CARD = ['#e9647f', '#f3a3b4', '#4c8f63', '#e6bd5a', '#7b2140'];

export function EmbroideryArt() {
    return (
        <svg className="ss-art ss-art-embroidery" viewBox="0 0 320 200" role="presentation" focusable="false" aria-hidden="true">
            <defs>
                <radialGradient id="ssVelvet" cx="50%" cy="38%" r="78%">
                    <stop offset="0" stopColor="#7b2140" />
                    <stop offset="1" stopColor="#3f0f21" />
                </radialGradient>
                <pattern id="ssSatinRose" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
                    <rect width="4" height="4" fill="#e9647f" />
                    <line x1="0" y1="0" x2="0" y2="4" stroke="#ffa4b7" strokeWidth="1.4" />
                </pattern>
                <pattern id="ssSatinLeaf" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
                    <rect width="4" height="4" fill="#4c8f63" />
                    <line x1="0" y1="0" x2="0" y2="4" stroke="#93d6a8" strokeWidth="1.3" />
                </pattern>
                <pattern id="ssSatinGold" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(90)">
                    <rect width="3" height="3" fill="#d9ad3f" />
                    <line x1="0" y1="0" x2="0" y2="3" stroke="#f6dd8a" strokeWidth="1" />
                </pattern>
            </defs>

            <rect width="320" height="200" fill="url(#ssVelvet)" />

            {/* zari border: running stitch outside, seed stitch inside */}
            <rect x="14" y="14" width="292" height="172" rx="3" fill="none" stroke="#e6bd5a" strokeWidth="2" strokeDasharray="7 3" />
            <rect x="23" y="23" width="274" height="154" rx="2" fill="none" stroke="#f3d98a" strokeWidth="1" strokeDasharray="2 3" />

            {/* leaves */}
            <path d="M104 132 C 84 108, 98 78, 130 84 C 126 110, 118 128, 104 132 Z" fill="url(#ssSatinLeaf)" stroke="#2f6b46" strokeWidth="1.2" />
            <path d="M216 132 C 236 108, 222 78, 190 84 C 194 110, 202 128, 216 132 Z" fill="url(#ssSatinLeaf)" stroke="#2f6b46" strokeWidth="1.2" />
            <path d="M112 118 Q 122 100 128 88" fill="none" stroke="#c7ecd2" strokeWidth="1" strokeDasharray="2 2" />
            <path d="M208 118 Q 198 100 192 88" fill="none" stroke="#c7ecd2" strokeWidth="1" strokeDasharray="2 2" />

            {/* chain-stitch stems */}
            <path d="M130 96 Q 144 100 148 104" fill="none" stroke="#7fc394" strokeWidth="2.2" strokeDasharray="3 2.5" strokeLinecap="round" />
            <path d="M190 96 Q 176 100 172 104" fill="none" stroke="#7fc394" strokeWidth="2.2" strokeDasharray="3 2.5" strokeLinecap="round" />

            {/* satin-stitch flower */}
            <g transform="translate(160 100)">
                {PETAL_ANGLES.map((angle) => (
                    <ellipse
                        key={angle}
                        cx="0"
                        cy="-30"
                        rx="13"
                        ry="27"
                        transform={`rotate(${angle})`}
                        fill="url(#ssSatinRose)"
                        stroke="#a8354f"
                        strokeWidth="1.2"
                    />
                ))}
                <circle r="12" fill="url(#ssSatinGold)" stroke="#b58a2a" strokeWidth="1.2" />
                {KNOT_ANGLES.map((angle) => (
                    <circle key={angle} cx="0" cy="-18" r="2.2" transform={`rotate(${angle})`} fill="#f6dd8a" stroke="#b58a2a" strokeWidth="0.6" />
                ))}
            </g>

            {/* small side motifs */}
            <g transform="translate(58 100)">
                <circle r="6" fill="url(#ssSatinGold)" stroke="#b58a2a" strokeWidth="1" />
                <circle cx="0" cy="-10" r="1.8" fill="#f6dd8a" />
                <circle cx="0" cy="10" r="1.8" fill="#f6dd8a" />
                <circle cx="-10" cy="0" r="1.8" fill="#f6dd8a" />
                <circle cx="10" cy="0" r="1.8" fill="#f6dd8a" />
            </g>
            <g transform="translate(262 100)">
                <circle r="6" fill="url(#ssSatinGold)" stroke="#b58a2a" strokeWidth="1" />
                <circle cx="0" cy="-10" r="1.8" fill="#f6dd8a" />
                <circle cx="0" cy="10" r="1.8" fill="#f6dd8a" />
                <circle cx="-10" cy="0" r="1.8" fill="#f6dd8a" />
                <circle cx="10" cy="0" r="1.8" fill="#f6dd8a" />
            </g>

            {/* thread shade card */}
            <g transform="translate(232 148)">
                <rect x="-8" y="-8" width="80" height="36" rx="7" fill="rgba(255,252,249,0.94)" />
                {THREAD_CARD.map((hex, index) => (
                    <rect key={hex} x={index * 14} y="0" width="10" height="20" rx="2" fill={hex} />
                ))}
            </g>
        </svg>
    );
}

/** Warp / weft colour sequence for a yarn-dyed madras-style check: [colour, width]. */
const CHECK_SEQUENCE = [
    ['#2f3f7a', 44],
    ['#efe7d6', 14],
    ['#c8553d', 22],
    ['#efe7d6', 14],
    ['#d9a441', 18],
    ['#efe7d6', 14],
];

function bands(limit) {
    const out = [];
    let offset = 0;
    while (offset < limit) {
        for (const [color, size] of CHECK_SEQUENCE) {
            if (offset >= limit) break;
            out.push({ color, size, offset });
            offset += size;
        }
    }
    return out;
}

const WARP = bands(320);
const WEFT = bands(200);
const DRAFT_CELLS = Array.from({ length: 64 }, (_, index) => ({ row: Math.floor(index / 8), col: index % 8 }));

export function WovenArt() {
    return (
        <svg className="ss-art ss-art-woven" viewBox="0 0 320 200" role="presentation" focusable="false" aria-hidden="true">
            <defs>
                <pattern id="ssTwill" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.26)" strokeWidth="1.3" />
                </pattern>
            </defs>

            {WARP.map((band) => (
                <rect key={`warp-${band.offset}`} x={band.offset} y="0" width={band.size} height="200" fill={band.color} />
            ))}
            {WEFT.map((band) => (
                <rect key={`weft-${band.offset}`} x="0" y={band.offset} width="320" height={band.size} fill={band.color} opacity="0.55" />
            ))}
            <rect width="320" height="200" fill="url(#ssTwill)" />

            {/* weave draft: 2/2 twill */}
            <g transform="translate(238 118)">
                <rect x="-8" y="-8" width="72" height="72" rx="8" fill="rgba(255,252,249,0.94)" />
                {DRAFT_CELLS.map(({ row, col }) => (
                    <rect
                        key={`${row}-${col}`}
                        x={col * 7}
                        y={row * 7}
                        width="6"
                        height="6"
                        rx="1"
                        fill={(row + col) % 4 < 2 ? '#2f3f7a' : '#e5ddcb'}
                    />
                ))}
            </g>
        </svg>
    );
}
