# NEXORA OMEGA — Living Digital World 2.0

A production-oriented foundation for an intent-driven digital environment by Made by Nexora WEB.

## Included now
- Natural-language Intent Engine and dynamic SHOP / BUSINESS / CREATE / ASK modes
- Product discovery, details, variant data and real backend order creation
- Voice input where browser support exists
- Adaptive world rendering and consent-aware interaction tracking
- Admin OS with secure cookie session, product CRUD, order status, analytics and evolution proposals
- Local JSON persistence (portable demo-to-production baseline)
- Optional OpenAI Responses API via `OPENAI_API_KEY` and `OPENAI_MODEL`
- Health endpoint and deploy-ready `npm start`

## Run
```bash
npm start
```
Open `/` for the world and `/admin` for Admin OS.

Default local admin password: `nexora-omega-2026`
Set `ADMIN_PASSWORD` in production, or change it from Admin OS after login.

## Production notes
For real scale, replace `data/data.json` with PostgreSQL/Turso, use a shared session store, HTTPS, a reverse proxy/CDN, object storage for uploads, monitoring and a real CI/CD pipeline. The current implementation does not pretend local JSON is horizontally scalable.
