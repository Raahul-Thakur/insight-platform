import { NextRequest } from "next/server";
import { errorJson, json, supabaseAdmin, toStartup } from "@/server/supabase";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const startupId = Number(id);
    const db = supabaseAdmin();
    const { data, error } = await db.from("startups").select("*").eq("id", startupId).single();
    if (error) throw error;

    const [{ data: sources }, { data: jobs }] = await Promise.all([
      db.from("startup_sources").select("*").eq("startup_id", startupId).order("last_checked_at", { ascending: false }),
      db.from("enrichment_jobs").select("*").eq("startup_id", startupId).order("created_at", { ascending: false }),
    ]);

    return json({
      ...toStartup(data),
      sources: (sources ?? []).map((source: any) => ({
        id: source.id,
        startupId: source.startup_id,
        sourceType: source.source_type,
        sourceUrl: source.source_url,
        extractedField: source.extracted_field,
        extractedValue: source.extracted_value,
        confidenceScore: source.confidence_score,
        lastCheckedAt: source.last_checked_at,
      })),
      enrichmentJobs: (jobs ?? []).map((job: any) => ({
        id: job.id,
        startupId: job.startup_id,
        startupName: data.name,
        jobType: job.job_type,
        status: job.status,
        errorMessage: job.error_message,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      })),
    });
  } catch (error) {
    return errorJson(error);
  }
}
