import { DEFAULT_ORG_ID, errorJson, generateEmbedding, json, ParsedFilters, supabaseAdmin, toStartup } from "@/server/supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query) return json({ error: "Query is required." }, { status: 400 });

    const db = supabaseAdmin();
    const normalizedQuery = query.toLowerCase();
    const filters = parseFilters(query);
    const queryEmbedding = generateEmbedding(normalizedQuery);

    const cached = await db
      .from("query_cache")
      .select("*")
      .eq("org_id", DEFAULT_ORG_ID)
      .eq("normalized_query", normalizedQuery)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    let startups: any[] = [];
    let cacheHit = false;
    const effectiveFilters = cached.data?.parsed_filters as ParsedFilters | undefined ?? filters;

    if (cached.data?.result_startup_ids?.length) {
      cacheHit = true;
      const result = await db.from("startups").select("*").in("id", cached.data.result_startup_ids);
      if (result.error) throw result.error;
      startups = result.data ?? [];
    } else {
      startups = await runStartupQuery(effectiveFilters, query);
      await db.from("query_cache").insert({
        org_id: DEFAULT_ORG_ID,
        query_text: query,
        normalized_query: normalizedQuery,
        query_embedding: `[${queryEmbedding.join(",")}]`,
        parsed_filters: effectiveFilters,
        result_startup_ids: startups.map((startup) => startup.id),
        similarity_score: 1,
        query_type: hasStructuredFilters(effectiveFilters) ? "exact" : "semantic",
        confidence_score: 0.9,
        source_versions: {},
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    return json({
      query,
      parsedFilters: effectiveFilters,
      startups: startups.map(toStartup),
      totalMatched: startups.length,
      cacheHit,
      processingMs: Math.max(1, Date.now() - started),
      provider: "system",
      model: hasStructuredFilters(effectiveFilters) ? "supabase-exact-filter" : "local-vector-search",
      answer: startups.length
        ? `Matched ${startups.length} startups using ${hasStructuredFilters(effectiveFilters) ? "structured filters" : "semantic search"}.`
        : "No startups matched this query.",
    });
  } catch (error) {
    return errorJson(error);
  }
}

async function runStartupQuery(filters: ParsedFilters, rawQuery: string) {
  const db = supabaseAdmin();
  let request = db.from("startups").select("*").eq("org_id", DEFAULT_ORG_ID).limit(500);

  if (filters.domain) request = request.ilike("domain", `%${filters.domain}%`);
  if (filters.fundingStage) request = request.ilike("funding_stage", `%${filters.fundingStage}%`);
  if (filters.location) request = request.ilike("hq_location", `%${filters.location}%`);
  if (filters.country) request = request.ilike("country", `%${filters.country}%`);

  const { data, error } = await request;
  if (error) throw error;

  let rows: any[] = data ?? [];
  if (filters.employeeCountMin != null) rows = rows.filter((row: any) => (row.employee_count ?? 0) >= filters.employeeCountMin!);
  if (filters.employeeCountMax != null) rows = rows.filter((row: any) => (row.employee_count ?? 0) <= filters.employeeCountMax!);
  if (filters.investor) rows = rows.filter((row: any) => (row.investors ?? []).some((investor: string) => includes(investor, filters.investor!)));
  if (filters.keyword) rows = rows.filter((row: any) => startupText(row).includes(filters.keyword!.toLowerCase()));

  if (!hasStructuredFilters(filters)) {
    const tokens = rawQuery.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    rows = rows
      .map((row: any) => ({
        row,
        score: tokens.reduce((score, token) => score + (startupText(row).includes(token) ? 1 : 0), 0),
      }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .map((item: { row: any }) => item.row);
  }

  return rows.slice(0, 50);
}

function parseFilters(query: string): ParsedFilters {
  const q = query.toLowerCase();
  const fundingStage = ["pre-seed", "seed", "series a", "series b", "series c", "bootstrapped"].find((stage) => q.includes(stage));
  const domainMap: Record<string, string> = {
    fintech: "Fintech",
    ai: "AI",
    "climate tech": "Climate",
    cleantech: "CleanTech",
    healthtech: "HealthTech",
    saas: "SaaS",
  };
  const domain = Object.entries(domainMap).find(([key]) => q.includes(key))?.[1] ?? null;
  const location = ["hyderabad", "bangalore", "bengaluru", "mumbai", "delhi", "chennai", "pune"].find((city) => q.includes(city));
  const emp = q.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(employees?|people|team)/);
  const investor = q.match(/(?:investor|investors|backed by|funded by)\s+([a-z0-9 .&-]+)/i)?.[1]?.trim() ?? null;

  return {
    domain,
    fundingStage: fundingStage ? titleCase(fundingStage) : null,
    location: location ? titleCase(location) : null,
    country: null,
    keyword: null,
    employeeCountMin: emp ? Number(emp[1]) : null,
    employeeCountMax: emp ? Number(emp[2]) : null,
    investor,
  };
}

function hasStructuredFilters(filters: ParsedFilters) {
  return Boolean(filters.domain || filters.fundingStage || filters.location || filters.country || filters.employeeCountMin != null || filters.employeeCountMax != null || filters.investor);
}

function startupText(row: any) {
  return [row.name, row.website, row.domain, row.subdomain, row.hq_location, row.country, row.funding_stage, row.description, row.website_summary, ...(row.founders ?? []), ...(row.investors ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function includes(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase());
}

function titleCase(value: string) {
  return value.split(" ").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}
