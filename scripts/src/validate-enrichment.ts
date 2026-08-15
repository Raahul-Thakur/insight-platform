import { crawlCompanyWebsite, extractFacts, reconcileFacts, type CachedPage, type PageCache } from "@workspace/enrichment-core";

const companies = [
  { segment: "well_known", name: "Stripe", website: "https://stripe.com" },
  { segment: "medium", name: "PostHog", website: "https://posthog.com" },
  { segment: "obscure", name: "Trigger.dev", website: "https://trigger.dev" },
  { segment: "sparse", name: "Example Domain", website: "https://example.com" },
];

for (const company of companies) {
  const rows = new Map<string, CachedPage>();
  const cache: PageCache = {
    async get(url) { return rows.get(url) ?? null; },
    async set(page) { rows.set(page.url, page); },
  };
  const firstStarted = Date.now();
  const first = await crawlCompanyWebsite(company.website, cache, { maxPages: 4, maxDepth: 1, fetchTimeoutMs: 8_000 });
  const reconciled = reconcileFacts(extractFacts(first.pages));
  const firstWallClockMs = Date.now() - firstStarted;
  const secondStarted = Date.now();
  const second = await crawlCompanyWebsite(company.website, cache, { maxPages: 4, maxDepth: 1, fetchTimeoutMs: 8_000 });
  process.stdout.write(`${JSON.stringify({
    ...company,
    fieldsRequested: ["name", "website", "description", "hqLocation", "country", "employeeCount", "founders", "linkedinUrl"],
    fieldsObtained: Object.keys(reconciled.values),
    fieldsWithoutLlm: Object.keys(reconciled.values).length,
    fieldsRequiringLlm: 0,
    sources: reconciled.selected.map((item) => ({ field: item.field, method: item.method, confidence: item.confidence, url: item.sourceUrl })),
    firstRequest: { ...first.telemetry, wallClockMs: firstWallClockMs, errors: first.errors },
    secondRequest: { ...second.telemetry, wallClockMs: Date.now() - secondStarted, errors: second.errors },
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedAiCost: 0,
  })}\n`);
}
