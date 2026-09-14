"""Browse Replicate's catalogue and check that the models RIMI AI offers still work.

Run from the repo root:

    python scripts/replicate-models.py collections
    python scripts/replicate-models.py browse text-to-image --limit 25
    python scripts/replicate-models.py browse super-resolution --new-since 2026-01-01
    python scripts/replicate-models.py roster
    python scripts/replicate-models.py check --confirm

Why this exists: four hosted models were retired under us in a single week — the Groq vision
model, google/upscaler, and both google/imagen-4-* — and every one was discovered by a user
hitting a failure. A retired model's Replicate page keeps resolving and still shows "Warm" with
millions of runs; only an actual prediction reveals the 404 from the provider's backend.

`check` is the part that would have caught all four. Note the asymmetry that makes it affordable:
Replicate does not bill failed predictions, so a dead model costs nothing to detect. Live models
do bill, which is why `check` refuses to run without --confirm and prints an estimate first.
"""
import argparse
import os
import sys
import time
from datetime import datetime, timezone

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

API = "https://api.replicate.com/v1"


def _token():
    token = os.getenv("REPLICATE_API_TOKEN")
    if not token:
        # backend/config.py loads the .env files; import it only if we must.
        try:
            import config  # noqa: F401
            token = os.getenv("REPLICATE_API_TOKEN")
        except Exception:
            pass
    if not token:
        sys.exit("REPLICATE_API_TOKEN is not set (put it in .env or backend/.env)")
    return token


def _get(path):
    r = requests.get(f"{API}{path}", headers={"Authorization": f"Bearer {_token()}"}, timeout=60)
    r.raise_for_status()
    return r.json()


def _age(iso):
    try:
        then = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return "?"
    days = (datetime.now(timezone.utc) - then).days
    if days < 90:
        return f"{days}d"
    if days < 730:
        return f"{days // 30}mo"
    return f"{days // 365}y"


def _runs(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(n)


def our_models():
    """Every Replicate model the product can reach, read from the code so it cannot drift."""
    # Single-purpose models that live at their call sites rather than in a registry. These are
    # named first so a specific tool beats the generic "inspire" fallback below. Maintaining this
    # by hand is a stopgap; a central registry would remove the need for it entirely.
    models = {
        "black-forest-labs/flux-fill-pro": "seamless (fix)",
        "replicate/seamless-texture": "seamless (generate)",
        "qwen/qwen-image-edit": "qwen studio (edit)",
        "qwen/qwen-image-layered": "qwen studio (layers)",
        "recraft-ai/recraft-vectorize": "vectorize",
        "851-labs/background-remover": "remove background",
        "fofr/style-transfer": "style transfer",
    }

    try:
        from config import REPLICATE_UPSCALE_MODEL
        models[REPLICATE_UPSCALE_MODEL] = "upscale"
    except Exception:
        pass

    try:
        from routes.generation import EXTRACT_MODELS, MODEL_TO_CREDITS
        from plan_tiers import NORMAL_INSPIRE_MODELS, PRO_INSPIRE_MODELS
        for m in EXTRACT_MODELS:
            prior = models.get(m["id"])
            models[m["id"]] = f"extract ({m['tier']})" + (f" + {prior}" if prior else "")
        for mid in NORMAL_INSPIRE_MODELS | PRO_INSPIRE_MODELS:
            if "extract" not in models.get(mid, ""):
                models.setdefault(mid, "inspire")
        # MODEL_TO_CREDITS is a price lookup, not an offer: it deliberately keeps entries for
        # retired models so historical replicate_logs rows still resolve. Anything only found
        # there is not something a user can pick.
        for mid in MODEL_TO_CREDITS:
            models.setdefault(mid, "price lookup only (not offered)")
    except Exception as exc:  # pragma: no cover - developer tool
        print(f"  ! could not read the model config: {exc}")

    return models


# Cheapest input that still exercises the model end to end. A model is only proven alive by a
# real prediction: an invalid input is rejected by Replicate before the provider is ever called,
# which is exactly how the Imagen retirements stayed invisible.
PROBE_INPUTS = {
    "text-to-image": {"prompt": "a flat seamless floral textile pattern tile"},
    "image-edit": {"prompt": "make the background white",
                   "image": "https://replicate.delivery/pbxt/M0gpKVE9wmEtOQFNDOpwz1uGs0u6nK2NcE85IihwlN0ZEnMF/kill-bill-poster.jpg"},
}


def cmd_collections(_args):
    cols = _get("/collections").get("results", [])
    print(f"{len(cols)} collections\n")
    for c in sorted(cols, key=lambda c: c["slug"]):
        print(f"  {c['slug']:<32} {c['name']}")


def cmd_browse(args):
    data = _get(f"/collections/{args.collection}")
    models = data.get("models", [])
    ours = our_models()

    if args.official:
        models = [m for m in models if m.get("is_official")]
    if args.new_since:
        models = [m for m in models if (m.get("created_at") or "") >= args.new_since]
    models.sort(key=lambda m: m.get("run_count") or 0, reverse=True)
    models = models[: args.limit]

    print(f"{data.get('name')} — showing {len(models)}"
          f"{' official' if args.official else ''} models by run count\n")
    print(f"  {'':<3}{'model':<42}{'runs':>8}{'age':>6}  description")
    print("  " + "-" * 96)
    for m in models:
        ref = f"{m['owner']}/{m['name']}"
        mark = "USE" if ref in ours else ("*" if m.get("is_official") else "")
        desc = (m.get("description") or "").replace("\n", " ")[:44]
        print(f"  {mark:<4}{ref:<42}{_runs(m.get('run_count') or 0):>8}"
              f"{_age(m.get('created_at')):>6}  {desc}")
    print("\n  USE = already in RIMI AI   * = official (maintained by the model's authors)")
    print("  Pricing is not exposed by the API; check the model page before adopting.")


def cmd_roster(_args):
    ours = our_models()
    print(f"{len(ours)} Replicate models reachable from the product\n")
    for ref, use in sorted(ours.items(), key=lambda kv: kv[1]):
        try:
            m = _get(f"/models/{ref.split(':')[0]}")
            official = "official" if m.get("is_official") else "community"
            print(f"  {ref:<42}{use:<22}{official:<10}{_runs(m.get('run_count') or 0):>7} runs")
        except requests.HTTPError as exc:
            print(f"  {ref:<42}{use:<22}PAGE GONE  ({exc.response.status_code})")


def cmd_check(args):
    """Prove each model still works by actually running it. This is the retirement detector."""
    from replicate_client import ReplicateError, run_model

    ours = {r: u for r, u in our_models().items()
            if r not in args.skip and "not offered" not in u}
    text_only = {r for r in ours if not any(
        k in r for k in ("vectorize", "background-remover", "esrgan", "image-edit",
                         "image-layered", "fill-pro", "seamless-texture"))}

    if not args.confirm:
        print(f"Would run {len(text_only)} text-to-image models end to end.\n")
        print("  Failed predictions are not billed, so retired models cost nothing to find.")
        print("  Live ones DO bill — roughly $0.02-0.07 each, so expect well under a dollar.")
        print("  Models needing an input image are skipped; they need a fixture to probe.\n")
        for r in sorted(text_only):
            print(f"    {r}")
        print("\nRe-run with --confirm to actually execute.")
        return

    print(f"{'model':<40}{'result':<10}detail")
    print("-" * 96)
    dead = []
    for ref in sorted(text_only):
        t = time.time()
        try:
            out = run_model(ref, dict(PROBE_INPUTS["text-to-image"]), timeout=args.timeout)
            url = str(out[0]) if isinstance(out, list) else str(out)
            print(f"{ref:<40}{'OK':<10}{time.time() - t:.1f}s  {url[:40]}")
        except ReplicateError as exc:
            msg = str(exc)
            retired = "404" in msg and "googleapis.com" in msg
            label = "RETIRED" if retired else "FAILED"
            dead.append((ref, label))
            print(f"{ref:<40}{label:<10}{msg[:60]}")

    print("-" * 96)
    if dead:
        print(f"\n{len(dead)} model(s) need attention:")
        for ref, label in dead:
            print(f"  {label}  {ref}")
        sys.exit(1)
    print("\nall probed models are alive")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("collections", help="list Replicate's curated collections")

    b = sub.add_parser("browse", help="list models in a collection, newest and most-used first")
    b.add_argument("collection", help="collection slug, e.g. text-to-image")
    b.add_argument("--limit", type=int, default=25)
    b.add_argument("--official", action="store_true", help="only models maintained by their authors")
    b.add_argument("--new-since", metavar="YYYY-MM-DD", help="only models created on or after this")

    sub.add_parser("roster", help="what RIMI AI currently offers, and whether the pages resolve")

    c = sub.add_parser("check", help="run each model to prove it still works (costs money)")
    c.add_argument("--confirm", action="store_true", help="actually run the predictions")
    c.add_argument("--timeout", type=float, default=180)
    c.add_argument("--skip", nargs="*", default=[], help="model refs to leave out")

    args = ap.parse_args()
    {"collections": cmd_collections, "browse": cmd_browse,
     "roster": cmd_roster, "check": cmd_check}[args.cmd](args)


if __name__ == "__main__":
    main()
