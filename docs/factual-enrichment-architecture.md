# Factual Enrichment Architecture

## Audit: Previous Architecture

The repository had two active enrichment implementations:

1. The primary Next/Supabase path queued `openai_web_enrichment` jobs in `POST /api/startups/:id/enrich` and processed them in `POST /api/jobs/process`.
2. The optional Express path queued in its durable JSON store and called `enrichStartupViaWebSearch` from a timer-based worker or `POST /api/web-enrichment/startup`.

Both paths treated an OpenAI Responses API call with web search as the factual provider. The Next path sent every missing/stale field to `gpt-5.4-mini`, then could send the same task to `gpt-5.4` when any result was empty or below confidence 0.55. The Express path made one `gpt-5.4-mini` web-search call asking for all 14 fields. The prompts requested industry, subdomain, headquarters, country, funding, employees, founders, investors, descriptions, and profile URLs together.

Existing useful foundations were retained: Supabase/Postgres, field refresh metadata, source tables, content hashes, manual-field precedence, enrichment jobs, local query caches, Pino logging, AI usage logs, the Express worker, and the existing enrichment UI. The earlier source fetcher only downloaded a homepage, did not validate destinations against SSRF, did not enforce byte or redirect limits, did not inspect JSON-LD, and still passed page text to the model. Normalized names were the original uniqueness key. A canonical-domain column had been added, but it was not a unique identity constraint.

Current enrichment fields classify as follows:

- Identity: `name`, `website`, `linkedin_url`, `crunchbase_url`, `tracxn_url`, canonical domain.
- Factual: `hq_location`, `country`, `funding_stage`, `total_funding`, `employee_count`, `founders`, `investors`.
- Extractive: `description`.
- Intelligence: `domain` (the schema uses this as industry/category), `subdomain`, and `website_summary` when explicitly requested as synthesis.

CSV values are marked manual and automated enrichment does not overwrite them. The UI does not currently expose a general field-edit form. Next jobs are persisted but processed when `/api/jobs/process` is invoked; the Express fallback has an interval worker. Supabase is the primary persistent store; Express has a process-local JSON store; the frontend has legacy browser-local fallback logic.

## New Architecture

```text
name / website -> normalized identity -> database/domain check
  -> bounded official-site discovery -> SSRF-safe fetch + page cache
  -> local HTML/metadata/JSON-LD parsing -> deterministic extraction
  -> source reconciliation -> manual-override check
  -> field provenance + canonical startup row -> search document
```

Standard enrichment does not require or call an LLM. `intelligence_enrichment` is a separate, explicitly requested level. It receives only compact structured observed facts and may infer category, subcategory, and a concise summary. Those values are stored with `observation_type = inferred` and `extraction_method = llm_inference`.

## Repository Changes

Created:

- `lib/enrichment-core`: shared entity normalization, URL security, fetcher/crawler, parser, deterministic extractors, reconciliation, types, and tests.
- `artifacts/startup-intel/src/server/enrichment/orchestrator.ts`: Supabase cache/persistence adapter and factual orchestration.
- `artifacts/startup-intel/src/server/ai/policy.ts`: centralized AI escalation and cost guardrails.
- `supabase/migrations/202608150001_factual_enrichment.sql`: identity uniqueness, observed/inferred metadata, run telemetry, and KPI function.
- `scripts/src/validate-enrichment.ts`: bounded live, no-LLM validation harness.
- `scripts/src/check-legacy-enrichment.ts`: read-only legacy-record availability check.

Modified: the Next job processor, trigger route, CSV import, Supabase helpers, environment example, UI labels, local-store compatibility methods, Express worker, direct route, persistent page cache, identity lookup, workspace manifests, lockfile, README, and documentation. Nothing was removed from the application or moved to another database.

## Database and Identity

The migration adds `extraction_method` and `observation_type` to field provenance. It normalizes canonical domains, marks exact-domain duplicate rows as duplicates without deleting or merging them, and adds a partial unique index for active canonical domains per organization. Existing duplicate records remain recoverable.

`enrichment_runs` records level, status, fetched/cached pages, failures, bytes, deterministic fields, actual LLM calls, tokens, estimated cost, duration, conflicts, and errors. `enrichment_cost_kpis(org, since)` returns LLM-free enrichment rate, field-level LLM rate, and average AI cost per company.

## Scraper and Cache

The crawler starts with the official canonical domain, reads robots.txt before an uncached fetch, and prioritizes a small set of same-origin about, team, product, pricing, customer, careers, contact, and press links. Defaults are six pages and depth one. It rejects binary paths and unsupported content types.

The fetcher enforces HTTP(S), DNS/IP validation, redirect revalidation, timeout, response-byte limits, redirect limits, a clear user-agent, and conditional ETag/Last-Modified requests. Responses are streamed and aborted once the byte limit is crossed. Cached parsed pages include normalized text, content hash, structured page data, timestamps, expiration, and validators. Redirect aliases are cached so a localized homepage is reused.

HTML is parsed locally. Script, style, navigation, footer, iframe, template, and other non-content nodes are excluded. The parser extracts title, meta/OG description, canonical URL, headings, paragraphs, links, JSON-LD Organization data, logo, social links, address, founders, and employee count. Malformed JSON-LD is ignored without failing the page. Raw HTML is never sent to a model.

## Providers and Deterministic Fields

Implemented provider: the official company website, supplying metadata, OpenGraph, JSON-LD/Schema.org, canonical links, content, and public profile links.

No search, funding, news, registry, GitHub, jobs, LinkedIn, Crunchbase, or Tracxn provider is claimed as implemented. The old arbitrary profile-API payloads were not retained because the repository has no defined response contract or configured licensed provider integration. The only prior search facility was the OpenAI web-search tool, which would keep factual retrieval coupled to model cost.

The standard path can obtain `name`, `website`, `description`, `hq_location`, `country`, `employee_count`, `founders`, `linkedin_url`, `crunchbase_url`, and `tracxn_url` without AI when the official site publishes evidence. It deliberately leaves unavailable values unresolved.

Reconciliation priority is manual data, official structured data, official metadata, then official deterministic link extraction. Equal-priority disagreements are recorded. Confidence uses HIGH/MEDIUM/LOW internally. Every selected field retains source URL, source type, retrieval time, method, confidence, and observed/inferred status.

## Remaining LLM Usage and Routing

Normal `factual_enrichment`, legacy queued `openai_web_enrichment`, and Express `website_crawl` jobs make zero LLM calls. The legacy job name is accepted for compatibility but processed factually.

Only an explicit `intelligence_enrichment` job can call OpenAI. Its task is category/subcategory interpretation and concise synthesis from compact observed facts. The cheap extraction model is selected first. Strong-model capacity exists in policy but defaults to zero expensive calls. No model receives raw HTML or search-tool access in enrichment.

Guardrails are configurable with `MAX_LLM_CALLS_PER_ENRICHMENT`, `MAX_EXPENSIVE_LLM_CALLS`, input/output token limits, and maximum estimated cost. Missing credentials or exhausted budgets produce a clean skip.

## Security

- Only HTTP and HTTPS are allowed.
- localhost, `.local`, loopback, link-local, RFC1918, unique-local IPv6, reserved/multicast ranges, and cloud metadata destinations are blocked.
- DNS answers are checked before every initial or redirected request; every redirect target is revalidated.
- Response type, size, time, redirect count, crawl depth, page count, origin, and file type are bounded.
- robots.txt disallows are respected; access controls, CAPTCHAs, paywalls, and authentication are not bypassed.
- Retrieved content is untrusted data. Active content is removed locally, and the intelligence prompt explicitly delimits evidence as non-instructional input.

## Validation

Offline tests: 8/8 passing. They cover domain/URL/name normalization, conservative identity matching, SSRF ranges and schemes, JSON-LD and metadata parsing, prompt-injection text removal, malformed structured data, page classification, facts, provenance, manual precedence, conflicts, and stable hashes. Tests make no network or paid calls.

Live validation on 2026-08-15 used at most four pages per domain and no model/API provider:

| Segment | Company | Deterministic fields obtained | First request | Second request | LLM |
|---|---|---|---:|---:|---:|
| Well-known | Stripe | name, description, website, founders, LinkedIn, Crunchbase | 4 pages, 2.24 MB, 2.2 s | 4 cached, 0 bytes, 3 ms | 0 |
| Medium | PostHog | description, website | 4 pages, 4.59 MB, 0.36 s | 4 cached, 0 bytes, 3 ms | 0 |
| Relatively obscure | Trigger.dev | name, website, description, LinkedIn | 4 pages, 1.52 MB, 4.0 s | 4 cached, 0 bytes, 3 ms | 0 |
| Sparse | Example Domain | website | 1 page, 559 bytes, 0.18 s | 1 cached, 0 bytes, 1 ms | 0 |

All selected facts included source URLs and methods. Input tokens, output tokens, and estimated AI cost were zero. A read-only query found no previously enriched record in the configured Supabase project, so a real legacy-record run was not possible; manual/legacy precedence is covered by tests.

## Cost Comparison

Before: Express factual enrichment made one `gpt-5.4-mini` web-search call per company. Next factual enrichment made one `gpt-5.4-mini` call and could make a second `gpt-5.4` call. Prompt input included up to roughly 12,000 source characters; output budgets were 1,600 tokens in Next and 4,096 in Express.

After for standard enrichment:

- LLM calls/company: 0.
- Input/output model tokens/company: 0/0.
- Estimated AI cost/company: $0.
- Structural LLM-free enrichment rate: 100% for standard jobs.
- Structural field-level LLM rate: 0% for standard jobs.
- Live second request: 100% page-cache hit rate and zero downloaded bytes.

Historical dollar cost cannot be reconstructed because configured model prices default to zero and the database has no legacy enriched run. The new KPI table measures future runs instead of inventing historical savings.

## Remaining Gaps

- Official websites rarely publish reliable funding, investors, funding stage, or current employee counts. Those remain unresolved without licensed providers.
- Products, pricing, customers, jobs, and logos are discoverable in the core representation, but the current `startups` schema has no canonical columns for most of them.
- No licensed search or structured company-data provider is configured.
- DNS validation reduces SSRF risk, but the fetcher does not pin the validated IP through the HTTP connection; infrastructure egress controls remain recommended against DNS rebinding.
- Regex-based HTML parsing is dependency-free but less complete than a standards-based DOM parser for severely malformed markup.
- The Next job runner is persistent but invoked by HTTP; no managed queue is configured.
- Live validation could not cover a legacy-enriched company because none exists in the configured database.

## Ranked Next Steps

1. Add one licensed structured company/funding provider behind the provider boundary.
2. Add columns and extractors for products, pricing, jobs, customers, and logos.
3. Add a standards-based server-side HTML parser after dependency review.
4. Run persistent jobs from the deployment scheduler/queue and add distributed per-domain throttling.
5. Add egress controls plus DNS/IP pinning, then expand the regression corpus with consented fixtures and expected facts.
