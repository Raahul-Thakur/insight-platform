# Startup Radar

An internal startup intelligence platform for tracking, enriching, and querying a portfolio of startups. Upload CSVs, review startup profiles, and query the data from the app.

## Run

Windows quick start:

- Install dependencies: `npx pnpm@10.25.0 install`
- Run the app: `npx pnpm@10.25.0 --filter @workspace/startup-intel run dev`
- Open: `http://localhost:5173`

The frontend stores imported CSV data in browser `localStorage`, so no database server is required.

Optional API server for backend routes and OpenAI enrichment:

- Add an OpenAI key to `.env`: `OPENAI_API_KEY=sk-...`
- For Supabase-backed Next API routes, also set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Optional AI cost controls are documented in `.env.example`, including `OPENAI_EXTRACTION_MODEL`, `OPENAI_ESCALATION_MODEL`, `ENRICHMENT_BATCH_SIZE`, `AI_MAX_PASSAGE_CHARS`, `AI_MAX_RETRIEVED_STARTUPS`, and `AI_MAX_STARTUPS_SENT_TO_MODEL`.
- Run the API server: `npx pnpm@10.25.0 --filter @workspace/api-server run dev`
- Run the frontend in another terminal: `npx pnpm@10.25.0 --filter @workspace/startup-intel run dev`

The API server uses app-local in-memory storage. Restarting the API process clears API-side data. The frontend app data persists in the browser.

## Commands

- `npx pnpm@10.25.0 --filter @workspace/startup-intel run dev` - run the frontend
- `npx pnpm@10.25.0 --filter @workspace/api-server run dev` - run the optional API server on port 5000
- `npx pnpm@10.25.0 run typecheck` - full typecheck
- `npx pnpm@10.25.0 run build` - typecheck and build all packages
- `npx pnpm@10.25.0 --filter @workspace/api-spec run codegen` - regenerate API hooks and Zod schemas from the OpenAPI spec

## Storage

- Frontend: browser `localStorage`
- Optional API server: in-memory process storage
- Supabase/Postgres is used by the Next API routes in `artifacts/startup-intel/src/app/api`; database changes live in `supabase/migrations`

## AI Cost Controls

- Apply Supabase migrations with `supabase db push`.
- See `docs/ai-cost-optimization.md` for field-level enrichment, source hashing, vector retrieval, cache invalidation, and backfill steps.
- AI usage is logged to `ai_usage_logs`; summaries are available through the `ai_cost_summary` SQL function.

## Stack

- pnpm workspaces, TypeScript
- Frontend: React + Vite + shadcn/ui + Recharts + Wouter
- Optional API: Express 5
- Validation: Zod (`zod/v4`)
- API codegen: Orval
- Build: esbuild
- File upload: multer + csv-parse

## Where Things Live

- `artifacts/startup-intel/src/lib/local-store.ts` - frontend localStorage persistence
- `artifacts/startup-intel/src/pages/` - frontend pages
- `artifacts/api-server/src/lib/appStore.ts` - optional API in-memory persistence
- `artifacts/api-server/src/routes/` - Express route handlers
- `artifacts/api-server/src/lib/enrichmentWorker.ts` - optional OpenAI enrichment worker
- `lib/api-spec/openapi.yaml` - OpenAPI spec
