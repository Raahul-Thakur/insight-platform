import OpenAI from "openai";
import { DEFAULT_ORG_ID, embeddingSql, errorJson, generateEmbedding, json, supabaseAdmin } from "@/server/supabase";
import { AI_LIMITS } from "@/server/ai/config";
import {
  buildEnrichmentPrompt,
  buildSearchDocument,
  createFieldMetadataRows,
  ENRICHABLE_FIELDS,
  fetchSourceSnapshot,
  getFieldsDueForEnrichment,
  modelForExtraction,
  normalizeExtractedFields,
  sha256,
  shouldEscalate,
} from "@/server/ai/enrichment";
import { logAiUsage, roughTokenCount } from "@/server/ai/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Number(body?.limit ?? AI_LIMITS.enrichmentBatchSize), 5);
    const db = supabaseAdmin();
    const { data: jobs, error } = await db
      .from("enrichment_jobs")
      .select("*, startups(*)")
      .eq("org_id", DEFAULT_ORG_ID)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw error;

    let completed = 0;
    let failed = 0;
    for (const job of jobs ?? []) {
      await db.from("enrichment_jobs").update({ status: "running" }).eq("id", job.id);
      try {
        const enriched = await enrichStartup(job.startups);
        await applyEnrichment(job.startups, enriched);
        await db.from("enrichment_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", job.id);
        completed += 1;
      } catch (error) {
        await db
          .from("enrichment_jobs")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : String(error),
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        failed += 1;
      }
    }

    return json({ processed: jobs?.length ?? 0, completed, failed });
  } catch (error) {
    return errorJson(error);
  }
}

export async function GET() {
  return POST(new Request("http://local", { method: "POST", body: JSON.stringify({ limit: 3 }) }));
}

async function enrichStartup(startup: any) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const started = Date.now();
  const db = supabaseAdmin();
  const { data: fieldStates } = await db
    .from("startup_field_enrichment")
    .select("field_name,status,confidence,refresh_after,content_hash,last_checked_at")
    .eq("startup_id", startup.id);

  const source = await fetchSourceSnapshot(db, startup);
  const fieldsDue = getFieldsDueForEnrichment(startup, fieldStates ?? [], source?.changed ?? false);
  if (fieldsDue.length === 0) {
    await logAiUsage(db, {
      orgId: startup.org_id ?? DEFAULT_ORG_ID,
      feature: "enrichment",
      routeType: "skip_fresh_fields",
      model: null,
      latencyMs: Date.now() - started,
      recordsRetrieved: 1,
      recordsSentToModel: 0,
      status: "skipped",
    });
    return { fields: {}, overall_confidence: startup.confidence_score ?? 0.9, sources: [], skipped: true };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let model = modelForExtraction(false);
  let prompt = buildEnrichmentPrompt(startup, fieldsDue, source);

  const response = await client.responses.create({
    model,
    input: prompt,
    tools: [{ type: "web_search_preview" }],
    max_output_tokens: 1600,
  });
  const match = response.output_text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("OpenAI enrichment returned no JSON.");
  let parsed = JSON.parse(match[0]);
  let normalizedFields = normalizeExtractedFields(parsed, fieldsDue);
  let escalated = false;
  let escalationReason: string | null = null;

  if (shouldEscalate(normalizedFields)) {
    escalated = true;
    escalationReason = "low_confidence_or_empty_extraction";
    model = modelForExtraction(true);
    prompt = `${prompt}\n\nPrevious low-confidence output:\n${response.output_text.slice(0, 2000)}\n\nResolve ambiguity if possible. Return only the same JSON shape.`;
    const escalatedResponse = await client.responses.create({
      model,
      input: prompt,
      tools: [{ type: "web_search_preview" }],
      max_output_tokens: 1600,
    });
    const escalatedMatch = escalatedResponse.output_text.match(/\{[\s\S]*\}/);
    if (escalatedMatch) {
      parsed = JSON.parse(escalatedMatch[0]);
      normalizedFields = normalizeExtractedFields(parsed, fieldsDue);
    }
  }

  const outputText = JSON.stringify(parsed);
  await logAiUsage(db, {
    orgId: startup.org_id ?? DEFAULT_ORG_ID,
    feature: "enrichment",
    routeType: "field_extraction",
    model,
    inputTokens: roughTokenCount(prompt),
    outputTokens: roughTokenCount(outputText),
    latencyMs: Date.now() - started,
    recordsRetrieved: 1,
    recordsSentToModel: 1,
    escalated,
    escalationReason,
  });

  return {
    ...Object.fromEntries(Object.entries(normalizedFields).map(([field, value]) => [field, value!.value])),
    fields: normalizedFields,
    fieldMetadataRows: createFieldMetadataRows(startup, normalizedFields, source, model, prompt, outputText),
    overall_confidence: parsed.overall_confidence ?? Math.max(...Object.values(normalizedFields).map((field) => field.confidence), 0.5),
    sources: Object.entries(normalizedFields).map(([field, value]) => ({
      source_url: value!.sourceUrl ?? source?.url ?? startup.website ?? null,
      extracted_field: field,
      extracted_value: JSON.stringify(value!.value),
      confidence_score: value!.confidence,
    })),
  };
}

async function applyEnrichment(startup: any, enriched: any) {
  const db = supabaseAdmin();
  if (enriched.skipped) {
    await upsertSearchDocument(db, startup);
    return;
  }
  const updates: Record<string, unknown> = {
    last_enriched_at: new Date().toISOString(),
    confidence_score: Math.max(startup.confidence_score ?? 0, Number(enriched.overall_confidence ?? 0.5)),
  };
  const manualFields = new Set(startup.manual_fields ?? []);
  const fieldConfidence = startup.field_confidence ?? {};
  const fieldLastVerifiedAt = startup.field_last_verified_at ?? {};
  const confidence = Number(enriched.overall_confidence ?? 0.5);

  for (const field of ENRICHABLE_FIELDS) {
    const value = enriched[field];
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (manualFields.has(camelField(field))) continue;
    if (startup[field] == null || startup[field] === "" || confidence > Number(fieldConfidence[field] ?? 0)) {
      updates[field] = value;
      fieldConfidence[field] = confidence;
      fieldLastVerifiedAt[field] = new Date().toISOString();
    }
  }
  updates.field_confidence = fieldConfidence;
  updates.field_last_verified_at = fieldLastVerifiedAt;

  const result = await db.from("startups").update(updates).eq("id", startup.id);
  if (result.error) throw result.error;

  if (Array.isArray(enriched.fieldMetadataRows) && enriched.fieldMetadataRows.length) {
    await db.from("startup_field_enrichment").upsert(enriched.fieldMetadataRows, { onConflict: "startup_id,field_name" });
  }

  if (Array.isArray(enriched.sources)) {
    await db.from("startup_sources").insert(enriched.sources.map((source: any) => ({
      org_id: DEFAULT_ORG_ID,
      startup_id: startup.id,
      source_type: "openai_web_search",
      source_url: source.sourceUrl ?? source.source_url ?? null,
      extracted_field: source.extractedField ?? source.extracted_field ?? "unknown",
      extracted_value: source.extractedValue ?? source.extracted_value ?? null,
      confidence_score: source.confidenceScore ?? source.confidence_score ?? confidence,
      last_checked_at: new Date().toISOString(),
    })));
  }

  await upsertSearchDocument(db, { ...startup, ...updates });
}

function camelField(field: string) {
  return field.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

async function upsertSearchDocument(db: any, startup: any) {
  const content = buildSearchDocument(startup);
  if (!content) return;
  const contentHash = sha256(content);
  const existing = await db
    .from("startup_search_documents")
    .select("content_hash")
    .eq("startup_id", startup.id)
    .eq("document_type", "profile")
    .maybeSingle();
  if (existing.data?.content_hash === contentHash) return;

  await db.from("startup_search_documents").upsert({
    org_id: startup.org_id ?? DEFAULT_ORG_ID,
    startup_id: startup.id,
    document_type: "profile",
    content,
    content_hash: contentHash,
    embedding: embeddingSql(generateEmbedding(content)),
    embedding_model: "local-hash-embedding-v1",
    metadata_json: {
      country: startup.country,
      industry: startup.domain,
      fundingStage: startup.funding_stage,
      employeeCount: startup.employee_count,
    },
  }, { onConflict: "startup_id,document_type" });
}
