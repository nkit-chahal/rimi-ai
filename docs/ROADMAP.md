# Post-Launch Roadmap

Items intentionally deferred from the flagship launch:

## Product differentiators
- Real 3D / CAD-class draping (CLO / Browzwear parity)
- Team workspaces UI + invite acceptance flow
- Recurring subscriptions with tier-based feature gates
- Customer-facing API key authentication + public API docs
- Real-time collaboration (comments, presence, shared edit)
- Print-grade export pipeline (CMYK TIFF, separated plates, DPI gate)
- Enterprise SSO (SAML/OIDC) and customer audit log export

## Engineering follow-ups
- Migrate long SSE job streams to Redis pub/sub
- Full CSS modularization / Tailwind adoption
- Visual regression suite for textile outputs
- Load testing with k6 for Replicate-heavy routes
