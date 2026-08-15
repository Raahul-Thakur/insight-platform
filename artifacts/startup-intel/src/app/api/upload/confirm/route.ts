import { DEFAULT_ORG_ID, errorJson, json, normalizeName, supabaseAdmin } from "@/server/supabase";
import { canonicalWebsite, normalizeDomain } from "@workspace/enrichment-core";

export const runtime = "nodejs";

type ImportRow = {
  name: string;
  website?: string | null;
  pocName?: string | null;
  pocEmail?: string | null;
  domain?: string | null;
  fundingStage?: string | null;
  hqLocation?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  crunchbaseUrl?: string | null;
  tracxnUrl?: string | null;
  founders?: string[] | null;
  investors?: string[] | null;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rows = Array.isArray(body?.rows) ? (body.rows as ImportRow[]) : [];
    const filename = typeof body?.filename === "string" ? body.filename : "upload.csv";
    const db = supabaseAdmin();
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    const upload = await db
      .from("uploaded_files")
      .insert({
        org_id: DEFAULT_ORG_ID,
        filename,
        original_filename: filename,
        row_count: rows.length,
        status: "importing",
      })
      .select("id")
      .single();
    if (upload.error) throw upload.error;

    for (const row of rows) {
      try {
        if (!row.name?.trim()) {
          skipped += 1;
          continue;
        }
        const normalized = normalizeName(row.name);
        const canonicalDomain = normalizeDomain(row.website);
        if (canonicalDomain) {
          const existing = await db.from("startups").select("id").eq("org_id", DEFAULT_ORG_ID)
            .eq("canonical_domain", canonicalDomain).is("duplicate_of_startup_id", null).maybeSingle();
          if (existing.data) {
            skipped += 1;
            continue;
          }
        }
        const manualFields = Object.entries(row)
          .filter(([, value]) => value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0))
          .map(([key]) => key);

        const result = await db
          .from("startups")
          .insert({
            org_id: DEFAULT_ORG_ID,
            name: row.name.trim(),
            normalized_name: normalized,
            website: canonicalWebsite(row.website) ?? "https://unknown.com",
            canonical_domain: canonicalDomain,
            poc_name: row.pocName?.trim() || null,
            poc_email: row.pocEmail?.trim() || null,
            domain: row.domain?.trim() || null,
            funding_stage: row.fundingStage?.trim() || null,
            hq_location: row.hqLocation?.trim() || null,
            country: row.country?.trim() || null,
            linkedin_url: row.linkedinUrl?.trim() || null,
            crunchbase_url: row.crunchbaseUrl?.trim() || null,
            tracxn_url: row.tracxnUrl?.trim() || null,
            founders: row.founders ?? [],
            investors: row.investors ?? [],
            manual_fields: manualFields,
          })
          .select("id, domain, funding_stage, hq_location")
          .single();

        if (result.error) {
          if (result.error.code === "23505") skipped += 1;
          else throw result.error;
          continue;
        }

        imported += 1;
        if (!result.data.domain || !result.data.funding_stage || !result.data.hq_location) {
          await db.from("enrichment_jobs").insert({
            org_id: DEFAULT_ORG_ID,
            startup_id: result.data.id,
            job_type: "factual_enrichment",
            status: "pending",
          });
        }
      } catch {
        errors += 1;
      }
    }

    await db
      .from("uploaded_files")
      .update({ imported_count: imported, status: errors > 0 && imported === 0 ? "failed" : "imported" })
      .eq("id", upload.data.id);

    return json({ imported, skipped, errors });
  } catch (error) {
    return errorJson(error);
  }
}
