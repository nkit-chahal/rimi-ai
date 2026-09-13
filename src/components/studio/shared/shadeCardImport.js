/**
 * Parse a supplier shade card (CSV or JSON) into entries the API accepts: { code, name, hex }.
 * Pure function so it can be unit tested without a browser.
 */

const HEX_RE = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

export function normalizeHex(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(HEX_RE);
    if (!match) return null;
    let digits = match[1].toLowerCase();
    if (digits.length === 3) digits = digits.split('').map((ch) => ch + ch).join('');
    return `#${digits}`;
}

function splitCsvLine(line) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (quoted && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                quoted = !quoted;
            }
        } else if ((ch === ',' || ch === ';' || ch === '\t') && !quoted) {
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells.map((cell) => cell.trim());
}

const CODE_HEADERS = ['code', 'shade', 'shade code', 'number', 'no', 'id', 'colour code', 'color code'];
const NAME_HEADERS = ['name', 'colour name', 'color name', 'description', 'shade name'];
const HEX_HEADERS = ['hex', 'colour', 'color', 'rgb', 'hex code', 'value'];

function pickColumn(headers, candidates) {
    const lowered = headers.map((h) => h.toLowerCase());
    for (const candidate of candidates) {
        const index = lowered.indexOf(candidate);
        if (index !== -1) return index;
    }
    return -1;
}

/**
 * Parse CSV text. Accepts a header row (code/name/hex in any order) or headerless rows
 * where the hex is the last colour-looking cell and the code is the first cell.
 */
export function parseShadeCardCsv(text) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) return { entries: [], errors: ['The file is empty'] };

    const firstCells = splitCsvLine(lines[0]);
    const hasHeader = !firstCells.some((cell) => HEX_RE.test(cell));
    let codeIdx = 0;
    let nameIdx = -1;
    let hexIdx = -1;
    let start = 0;

    if (hasHeader) {
        codeIdx = pickColumn(firstCells, CODE_HEADERS);
        nameIdx = pickColumn(firstCells, NAME_HEADERS);
        hexIdx = pickColumn(firstCells, HEX_HEADERS);
        start = 1;
        if (codeIdx === -1) codeIdx = 0;
    }

    const entries = [];
    const errors = [];
    for (let i = start; i < lines.length; i += 1) {
        const cells = splitCsvLine(lines[i]);
        if (!cells.some(Boolean)) continue;
        let hex = hexIdx !== -1 ? normalizeHex(cells[hexIdx]) : null;
        if (!hex) {
            const hexCell = [...cells].reverse().find((cell) => HEX_RE.test(cell));
            hex = normalizeHex(hexCell);
        }
        const code = (cells[codeIdx] || '').trim();
        const name = nameIdx !== -1 ? (cells[nameIdx] || '').trim() : (cells.length >= 3 ? cells[1] : '');
        if (!code || !hex) {
            errors.push(`Line ${i + 1}: needs a shade code and a hex colour`);
            continue;
        }
        entries.push({ code, name, hex });
    }
    return { entries, errors };
}

/** Parse a JSON export: either an array of entries or { entries: [...] }. */
export function parseShadeCardJson(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { entries: [], errors: ['Invalid JSON'] };
    }
    const list = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(list)) return { entries: [], errors: ['JSON must be an array of entries or { entries: [...] }'] };
    const entries = [];
    const errors = [];
    list.forEach((item, index) => {
        const hex = normalizeHex(item?.hex ?? item?.color ?? item?.colour);
        const code = String(item?.code ?? item?.number ?? '').trim();
        if (!code || !hex) {
            errors.push(`Entry ${index + 1}: needs a shade code and a hex colour`);
            return;
        }
        entries.push({ code, name: String(item?.name ?? '').trim(), hex });
    });
    return { entries, errors };
}

export function parseShadeCardFile(filename, text) {
    return /\.json$/i.test(filename || '') ? parseShadeCardJson(text) : parseShadeCardCsv(text);
}

/** Human label for a Delta E 2000 distance. */
export function deltaEQuality(deltaE) {
    if (deltaE <= 1) return { label: 'Exact', tone: 'exact' };
    if (deltaE <= 3) return { label: 'Very close', tone: 'close' };
    if (deltaE <= 6) return { label: 'Close', tone: 'ok' };
    return { label: 'Nearest', tone: 'far' };
}

/** Build a CSV of a thread palette for the embroidery unit. */
export function threadPaletteToCsv(entries) {
    const header = 'source_hex,shade_code,shade_name,shade_hex,delta_e';
    const rows = (entries || []).map((entry) => [
        entry.sourceHex || '',
        entry.code || '',
        `"${String(entry.name || '').replace(/"/g, '""')}"`,
        entry.hex || '',
        entry.deltaE != null ? Number(entry.deltaE).toFixed(2) : '',
    ].join(','));
    return [header, ...rows].join('\n');
}
