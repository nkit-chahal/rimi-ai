const fs = require('fs');
let c = fs.readFileSync('src/pages/Studio.jsx', 'utf8');
let changes = 0;

function rep(bad, good) {
  const escaped = bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'g');
  const matches = c.match(re);
  if (matches) {
    console.log('Replacing ' + JSON.stringify(bad) + ' with ' + JSON.stringify(good) + ' (' + matches.length + ' hits)');
    c = c.replace(re, good);
    changes += matches.length;
  }
}

// Checkmarks: \u00e2\u0153\u201c = broken checkmark
rep('\u00e2\u0153\u201c', '\u2713');
// Checkmark variation: \u00e2\u0153\u2014
rep('\u00e2\u0153\u2014', '\u2717');
// Check mark bold: \u00e2\u0153\u2026
rep('\u00e2\u0153\u0085', '\u2714');

// Green checkmark emoji: \u00e2\u0153\u0085\u00ef\u00b8\u008f (with variation selector)
// Actually let's just find all remaining non-ASCII multi-byte sequences
// and log them so we can see what's left

const lines = c.split('\n');
lines.forEach((line, i) => {
  // Find runs of chars in the C0/C1 range that are typical mojibake
  const m = line.match(/[\u00c0-\u00ff][\u0080-\u00ff\u0152-\u0178\u2013-\u201e]{1,5}/g);
  if (m) {
    m.forEach(seq => {
      const hex = Array.from(seq).map(ch => 'U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');
      const ctx = line.substring(Math.max(0, line.indexOf(seq) - 15), line.indexOf(seq) + seq.length + 15).trim();
      console.log('Line ' + (i+1) + ': ' + hex + ' => "' + ctx + '"');
    });
  }
});

fs.writeFileSync('src/pages/Studio.jsx', c, 'utf8');
console.log('\nDone! Fixed ' + changes + ' replacements. Review remaining lines above.');
