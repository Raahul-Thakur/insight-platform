import { NextRequest } from "next/server";
import { DEFAULT_ORG_ID, errorJson, json, supabaseAdmin } from "@/server/supabase";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const startupId = Number(id);
    const body = await _request.json().catch(() => ({}));
    const jobType = body?.level === "intelligence" ? "intelligence_enrichment" : "factual_enrichment";
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("enrichment_jobs")
      .insert({
        startup_id: startupId,
        org_id: DEFAULT_ORG_ID,
        job_type: jobType,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw error;
    return json(data, { status: 202 });
  } catch (error) {
    return errorJson(error);
  }
}
