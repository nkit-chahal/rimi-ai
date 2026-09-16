# RIMI AI — company one-pager

A self-contained page for showing the product to clients. Not wired into the app, not deployed.

## Viewing it

Open `website/index.html` in a browser. That is all — the folder is self-contained, so it also
works from any static server, including as its own root:

```bash
npx serve website     # or: npx serve .  ->  /website/
```

With the dev server running it is also at `http://localhost:5173/website/`. Note that is a **dev
server only** route: `website/` is outside `public/` and is not an entry point, so it is not part
of `npm run build` and will not appear on a production deploy.

Total weight is about 810 KB — 782 KB of that is the six prints. The only external request is the
Google font, which falls back to a system sans cleanly offline.

## The three-colour system

Taken from the product's own `src/styles/tokens.css`, so the page and the studio are the same
brand rather than merely similar. No fourth hue appears anywhere.

| Role | Colour | Where it is used |
|---|---|---|
| Primary | violet `#8B5CF6` | Brand mark, buttons, links, most accents |
| Warm | coral `#F43F5E` | Emphasis — step 02, the "Product Mockups" and "Layer Studio" tiles, the popular plan |
| Cool | emerald `#10B981` | Production and positive signals — step 03, measurement, tech packs, "In development" |

Anchored on ink `#0B0910` and paper `#F3F0EC`. Dark and light sections alternate to give the page
rhythm; each accent also carries a consistent meaning rather than being decorative.

## The artwork

The six prints in `assets/` were generated through RIMI AI's own pipeline — `seedream-4.5` via
`backend/replicate_client.py`, at a cost of roughly $0.24. That is what makes the line "Every
print on this page was generated in RIMI AI" true, so **do not replace them with stock imagery**
without also removing that claim.

To regenerate or extend the set, the prompts are in the session history; the pattern is a flat-2D
seamless brief plus a style sentence, rendered at 2K and saved as 1024px WebP.

The hero texture and the two large bento tiles reuse `deco.webp` and `palm.webp` as CSS
backgrounds. They tile correctly because they are genuine seamless repeats — which is itself a
small demonstration of the product.

## Motion

Deliberately restrained, matching the principle applied to the app itself: motion reports change,
so nothing loops for decoration.

- **Reveal on scroll** — each block fades up once as it arrives, then the observer disconnects.
- **The print marquee** is the one continuous animation. It earns that by showing more output than
  fits on screen, and it pauses on hover.
- `prefers-reduced-motion` stops the marquee, disables the reveals and shows everything at rest.

## What the numbers are, and where they came from

Everything is read out of the code rather than invented, so it holds up under questioning:

| Claim | Source |
|---|---|
| Plan names, prices, credits | `BILLING_PLANS` in `backend/routes/billing.py` (amounts are paise; the page shows rupees) |
| Model list | `EXTRACT_MODELS` / `MODEL_TO_CREDITS` in `backend/routes/generation.py` |
| 31 mockup products | `MAPPING_PRODUCTS` in `src/components/studio/tools/MappingsTool.jsx` |
| Tool descriptions | the tools in `src/components/studio/tools/` |

Embroidery and Woven are marked **In development** on purpose — they live on the
`feature/2-new-product-lines` branch, not on `main`. Do not present them as shipping.

## Before sending it to anyone

- `hello@rimiai.pro` is a placeholder in three places (both "Book a demo" buttons and the footer).
- There is no analytics, no tracking and no form; the CTA is a `mailto:` link.
- Prices are INR and exclusive of taxes, as the page states. Confirm that still holds.
- Consider adding real customer work alongside the generated prints once you have permission — a
  named mill or brand would do more for credibility than any of the copy.

## Editing

One file, inline CSS, no build step, no dependencies beyond the font. The palette lives in the
`:root` block at the top of `index.html`; if the brand colours move in `tokens.css`, update it
there to match.
