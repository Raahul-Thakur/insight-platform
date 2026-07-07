import OpenAI from "openai";
import { DEFAULT_ORG_ID, errorJson, json, supabaseAdmin } from "@/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const ENRICHABLE_FIELDS = [
  "domain",
  "subdomain",
  "hq_location",
  "country",
  "funding_stage",
  "total_funding",
  "employee_count",
  "founders",
  "investors",
  "description",
  "website_summary",
  "linkedin_url",
  "crunchbase_url",
  "tracxn_url",
] as const;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Number(body?.limit ?? 3), 5);
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
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const websiteContext = await getWebsiteText(startup.website);
  const prompt = `Return only JSON for this startup enrichment. Fill missing or low-confidence fields only.

Startup:
${JSON.stringify({
  name: startup.name,
  website: startup.website,
  domain: startup.domain,
  location: startup.hq_location,
  fundingStage: startup.funding_stage,
  linkedinUrl: startup.linkedin_url,
  crunchbaseUrl: startup.crunchbase_url,
  tracxnUrl: startup.tracxn_url,
})}

Website text:
${websiteContext.slice(0, 6000)}

JSON shape:
{
  "domain": null,
  "subdomain": null,
  "hq_location": null,
  "country": null,
  "funding_stage": null,
  "total_funding": null,
  "employee_count": null,
  "founders": [],
  "investors": [],
  "description": null,
  "website_summary": null,
  "linkedin_url": null,
  "crunchbase_url": null,
  "tracxn_url": null,
  "overall_confidence": 0.0,
  "sources": []
}`;

  const response = await client.responses.create({
    model: process.env.OPENAI_ENRICHMENT_MODEL ?? "gpt-5.4-mini",
    input: prompt,
    tools: [{ type: "web_search_preview" }],
    max_output_tokens: 4096,
  });
  const match = response.output_text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("OpenAI enrichment returned no JSON.");
  return JSON.parse(match[0]);
}

async function applyEnrichment(startup: any, enriched: any) {
  const db = supabaseAdmin();
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
}

async function getWebsiteText(website: string | null) {
  if (!website) return "";
  const db = supabaseAdmin();
  const url = website.startsWith("http") ? website : `https://${website}`;
  const cached = await db.from("crawled_pages").select("*").eq("normalized_url", normalizeUrl(url)).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (cached.data) return cached.data.text ?? "";

  try {
    const response = await fetch(url, { headers: { "user-agent": "StartupIntelBot/1.0" } });
    if (!response.ok) return "";
    const html = await response.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    await db.from("crawled_pages").upsert({
      org_id: DEFAULT_ORG_ID,
      url,
      normalized_url: normalizeUrl(url),
      title: null,
      text,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "org_id,normalized_url" });
    return text;
  } catch {
    return "";
  }
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.toLowerCase();
  }
}

function camelField(field: string) {
  return field.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}
