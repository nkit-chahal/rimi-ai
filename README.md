# RIMI AI

AI-powered textile and surface-pattern design studio. Upload artwork, extract patterns, create seamless repeats, vectorize, manage colorways, preview on products, and export production-ready assets.

## Features

- **Pattern Extraction** — AI-powered motif and layout extraction from reference images
- **Make Seamless** — Tile artwork into seamless repeating patterns
- **Repeat Set** — Build repeat grids at any scale
- **Inspirations** — Generate creative variations from existing designs
- **Vectorize** — Cloud or local raster-to-vector conversion
- **Colorways** — Palette extraction, recoloring, and Pantone matching
- **3D Mockups** — Preview patterns on apparel and home products
- **Pipeline Studio** — Multi-step workflows with export history
- **Credits & Billing** — Usage-based credits with Razorpay top-ups (INR)

## Tech stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React 19, Vite 8, Fabric.js, React Three Fiber |
| Backend | Flask, Gunicorn, Pillow, vtracer/potrace |
| AI | Replicate (image generation), Groq Llama 4 Scout (vision) |
| Database | SQLite (local), PostgreSQL (production) |
| Storage | Local filesystem + S3-compatible object storage |
| Payments | Razorpay |

## Project structure

```
RIMI_AI/
├── src/                      # React frontend
│   ├── App.jsx               # Login → Studio routing
│   ├── pages/                # Login, Studio
│   └── components/studio/    # Tool panels, admin, shared helpers
├── backend/
│   ├── server.py             # Flask app entry point
│   ├── routes/               # API blueprints
│   ├── auth.py               # JWT, credits, activity logging
│   └── db.py                 # Schema + SQLite/PostgreSQL adapter
├── public/products/          # Mockup product images
├── start.bat                 # Windows: start backend + frontend
└── deploy.sh                 # Linux: nginx + gunicorn deployment
```

## Quick start (local)

### Prerequisites

- Node.js 20+
- Python 3.10+
- API keys: [Replicate](https://replicate.com), [Groq](https://groq.com) (optional: Razorpay, Google OAuth)

### 1. Backend

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in your keys
python server.py
```

Backend runs at **http://localhost:3001**.

### 2. Frontend

```bash
npm install
npm run dev
```

Frontend runs at **http://localhost:5173**. In dev, Vite proxies `/api`, `/uploads`, and `/results` to the backend — no CORS setup needed.

### Windows shortcut

```bat
start.bat
```

## Environment variables

### Backend (`backend/.env`)

Copy `backend/.env.example` and configure:

| Variable | Description |
|----------|-------------|
| `REPLICATE_API_TOKEN` | Replicate API token for AI image models |
| `GROQ_API_KEY` | Groq API key for image description |
| `JWT_SECRET` | Secret for signing auth tokens (required in production) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Payment integration |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `DATABASE_URL` | PostgreSQL connection string (omit for SQLite) |
| `AWS_*` | S3-compatible storage (optional) |
| `CORS_ORIGINS` | Allowed frontend origins (comma-separated) |

### Frontend (optional `.env` in project root)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend URL when frontend and API are on different hosts (e.g. Vercel + Railway). Leave unset for same-origin or dev proxy. |
| `VITE_RAZORPAY_KEY_ID` | Razorpay public key for checkout UI |

## Production deployment

`deploy.sh` builds the frontend, sets up Gunicorn via PM2, and configures nginx to:

- Serve the React build from `/var/www/rimi-ai/dist`
- Proxy `/api/` to the Flask backend
- Serve `/uploads/` and `/results/` as static files

For split hosting (frontend on Vercel, backend on Railway), set `VITE_API_URL` to your backend URL at build time and configure `CORS_ORIGINS` on the backend.

## API overview

All endpoints are under `/api/`. Key routes:

- `POST /api/upload` — Upload artwork
- `POST /api/extract-design` — Pattern extraction
- `POST /api/make-seamless` — Seamless tiling
- `POST /api/create-repeat-set` — Repeat grid generation
- `POST /api/vectorize` — Vectorization
- `POST /api/generate-inspirations` — AI variations
- `GET /api/studio-state` — Project and dashboard state

Authenticated requests require `Authorization: Bearer <token>`.

## Development notes

- **Studio shell** — `src/pages/Studio.jsx` is the main app shell; individual tools live in `src/components/studio/tools/`.
- **Credits** — Each AI operation deducts credits defined in `backend/db.py`.
- **AI agent rules** — See `AI_INSTRUCTIONS.md` before making large refactors.

## License

Private — all rights reserved.
