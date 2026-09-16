# RIMI AI — company one-pager

A single, self-contained page for showing the product to clients. Not wired into the app, not
deployed anywhere.

## Viewing it

Open `website/index.html` in a browser, or serve the repo root so the paths resolve:

```bash
npx serve .          # then open http://localhost:3000/website/
```

The artwork is referenced as `../public/demo_*.webp`, so it works when opened directly or served
from the repo root. **Serving `website/` as its own root will break the images** — copy the three
demo files in first if you need it standalone.

## What is on it, and where the numbers came from

Everything is taken from the code rather than invented, so it stays defensible in a client
meeting:

| Claim | Source |
|---|---|
| Plan names, prices, credits | `BILLING_PLANS` in `backend/routes/billing.py` (amounts are paise; the page shows rupees) |
| Model list | `EXTRACT_MODELS` / `MODEL_TO_CREDITS` in `backend/routes/generation.py` |
| 31 mockup products | `MAPPING_PRODUCTS` in `src/components/studio/tools/MappingsTool.jsx` |
| Tool descriptions | the tools in `src/components/studio/tools/` |

Embroidery and Woven are marked **In development** on purpose — they live on the
`feature/2-new-product-lines` branch, not on `main`. Do not present them as shipping.

## Before sending it to anyone

- `hello@rimiai.pro` is a placeholder in two places (the two "Book a demo" links and the footer).
  Replace it with a real address.
- The three demo prints are the app's built-in placeholders. Swapping in real customer work —
  with permission — would make the page considerably stronger.
- Prices are INR and exclusive of taxes, as stated on the page. Check that still holds.
- There are no analytics, no tracking and no forms; it is a static file.

## Editing

One file, inline CSS, no build step and no dependencies beyond the Google font. The palette is
copied from the product's `src/styles/tokens.css` so the page and the studio look related — if
the brand colours change there, update the `:root` block at the top of `index.html` to match.
