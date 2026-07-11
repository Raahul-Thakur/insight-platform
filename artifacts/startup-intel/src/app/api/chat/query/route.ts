import { DEFAULT_ORG_ID, embeddingSql, errorJson, generateEmbedding, json, supabaseAdmin, toStartup } from "@/server/supabase";
import { createCacheHash, hasStructuredFilters, normalizeQuestion, routeStartupQuery, startupSearchText, type QueryRoute } from "@/server/ai/chat";
import { AI_LIMITS } from "@/server/ai/config";
import { logAiUsage } from "@/server/ai/usage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query) return json({ error: "Query is required." }, { status: 400 });

    const db = supabaseAdmin();
    const normalizedQuery = normalizeQuestion(query);
    const route = routeStartupQuery(query);
    const filters = route.filters;
    const queryEmbedding = generateEmbedding(normalizedQuery);
    const datasetVersion = await getDatasetVersion(db, DEFAULT_ORG_ID);
    const queryHash = createCacheHash({
      orgId: DEFAULT_ORG_ID,
      normalizedQuery,
      filters,
      datasetVersion,
      route: route.route,
    });

    const cached = await db
      .from("ai_query_cache")
      .select("*")
      .eq("tenant_id", DEFAULT_ORG_ID)
      .eq("query_hash", queryHash)
      .eq("dataset_version", datasetVersion)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    let startups: any[] = [];
    let cacheHit = false;
    const effectiveFilters = cached.data?.filters_json as QueryRoute["filters"] | undefined ?? filters;
    let answer = "";

    if (cached.data?.response_json) {
      cacheHit = true;
      await db.from("ai_query_cache").update({ hit_count: (cached.data.hit_count ?? 0) + 1, last_accessed_at: new Date().toISOString() }).eq("id", cached.data.id);
      startups = cached.data.response_json.startupsRaw ?? [];
      answer = cached.data.response_json.answer ?? "";
    } else {
      const result = await runStartupQuery(route, query, queryEmbedding);
      startups = result.rows;
      answer = result.answer;
      await db.from("ai_query_cache").insert({
        org_id: DEFAULT_ORG_ID,
        tenant_id: DEFAULT_ORG_ID,
        query_hash: queryHash,
        normalized_query: normalizedQuery,
        query_embedding: embeddingSql(queryEmbedding),
        route_type: route.route,
        filters_json: effectiveFilters,
        dataset_version: datasetVersion,
        response_json: { answer, startupsRaw: startups },
        source_record_ids: startups.map((startup) => startup.id),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    await logAiUsage(db, {
      orgId: DEFAULT_ORG_ID,
      feature: "chatbot",
      routeType: route.route,
      model: route.requiresLlmResponse ? "not-called-retrieval-only" : "none",
      latencyMs: Date.now() - started,
      cacheHit,
      recordsRetrieved: startups.length,
      recordsSentToModel: 0,
      embeddingTokens: normalizedQuery.split(/\s+/).length,
    });

    return json({
      query,
      parsedFilters: effectiveFilters,
      startups: startups.map(toStartup),
      totalMatched: startups.length,
      cacheHit,
      processingMs: Math.max(1, Date.now() - started),
      provider: "system",
      model: route.route === "semantic_search" || route.route === "hybrid_search" ? "local-vector-search" : "supabase-structured-query",
      answer,
      routeType: route.route,
      datasetVersion,
    });
  } catch (error) {
    return errorJson(error);
  }
}

async function runStartupQuery(route: QueryRoute, rawQuery: string, queryEmbedding: number[]): Promise<{ rows: any[]; answer: string }> {
  const db = supabaseAdmin();
  const filters = route.filters;
  let request = db.from("startups").select("*", { count: "exact" }).eq("org_id", DEFAULT_ORG_ID).limit(route.operation === "list" ? 50 : AI_LIMITS.maxRetrievedStartups);

  if (filters.domain) request = request.ilike("domain", `%${filters.domain}%`);
  if (filters.fundingStage) request = request.ilike("funding_stage", `%${filters.fundingStage}%`);
  if (filters.location) request = request.ilike("hq_location", `%${filters.location}%`);
  if (filters.country) request = request.ilike("country", `%${filters.country}%`);

  const { data, error, count } = await request;
  if (error) throw error;

  let rows: any[] = data ?? [];
  if (filters.employeeCountMin != null) rows = rows.filter((row: any) => (row.employee_count ?? 0) >= filters.employeeCountMin!);
  if (filters.employeeCountMax != null) rows = rows.filter((row: any) => (row.employee_count ?? 0) <= filters.employeeCountMax!);
  if (filters.investor) rows = rows.filter((row: any) => (row.investors ?? []).some((investor: string) => includes(investor, filters.investor!)));
  if (filters.keyword) rows = rows.filter((row: any) => startupSearchText(row).includes(filters.keyword!.toLowerCase()));

  if (route.operation === "missing_fields") {
    rows = rows.filter((row: any) => !row.domain || !row.funding_stage || !row.hq_location || !row.description);
    return { rows: rows.slice(0, 50), answer: `Found ${rows.length} startups with missing enrichment fields.` };
  }

  if (route.operation === "count") {
    return { rows: [], answer: `Matched ${count ?? rows.length} startups.` };
  }

  if (route.route === "semantic_search" || route.route === "hybrid_search") {
    const vectorRows = await runVectorSearch(db, route, queryEmbedding);
    if (vectorRows.length > 0) {
      return {
        rows: vectorRows,
        answer: `Matched ${vectorRows.length} startups using ${route.route === "hybrid_search" ? "hybrid SQL and vector retrieval" : "vector retrieval"}.`,
      };
    }

    const tokens = rawQuery.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    rows = rows
      .map((row: any) => ({
        row,
        score: tokens.reduce((score, token) => score + (startupSearchText(row).includes(token) ? 1 : 0), 0),
      }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .map((item: { row: any }) => item.row);
  }

  const limited = rows.slice(0, route.operation === "list" ? 50 : AI_LIMITS.maxRetrievedStartups);
  return {
    rows: limited,
    answer: limited.length
      ? `Matched ${limited.length} startups using ${hasStructuredFilters(filters) ? "structured filters" : "semantic retrieval"}.`
      : "No startups matched this query.",
  };
}

function includes(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase());
}

async function getDatasetVersion(db: any, orgId: string) {
  const { data } = await db.from("ai_dataset_versions").select("version").eq("org_id", orgId).maybeSingle();
  return Number(data?.version ?? 1);
}

async function runVectorSearch(db: any, route: QueryRoute, queryEmbedding: number[]) {
  const filters = route.filters;
  const matched = await db.rpc("match_startup_search_documents", {
    target_org_id: DEFAULT_ORG_ID,
    query_embedding: embeddingSql(queryEmbedding),
    match_count: Math.min(route.limit, AI_LIMITS.maxRetrievedStartups),
    filter_country: filters.country ? `%${filters.country}%` : null,
    filter_industry: filters.domain ? `%${filters.domain}%` : null,
    filter_funding_stage: filters.fundingStage ? `%${filters.fundingStage}%` : null,
  });
  if (matched.error || !matched.data?.length) return [];

  const ids = matched.data
    .filter((row: any) => Number(row.similarity ?? 0) >= 0.15)
    .map((row: any) => row.startup_id);
  if (!ids.length) return [];

  const rows = await db.from("startups").select("*").eq("org_id", DEFAULT_ORG_ID).in("id", ids);
  if (rows.error) return [];
  const byId = new Map((rows.data ?? []).map((row: any) => [row.id, row]));
  return ids.map((id: number) => byId.get(id)).filter(Boolean);
}
