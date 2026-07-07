import { NextRequest } from "next/server";
import { DEFAULT_ORG_ID, errorJson, json, supabaseAdmin } from "@/server/supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const params = request.nextUrl.searchParams;
    const page = Number(params.get("page") ?? "1");
    const limit = Number(params.get("limit") ?? "20");
    const status = params.get("status");
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = db
      .from("enrichment_jobs")
      .select("*, startups(name)", { count: "exact" })
      .eq("org_id", DEFAULT_ORG_ID)
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;

    return json({
      jobs: (data ?? []).map((job: any) => ({
        id: job.id,
        startupId: job.startup_id,
        startupName: job.startups?.name ?? null,
        jobType: job.job_type,
        status: job.status,
        errorMessage: job.error_message,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      })),
      total: count ?? 0,
      page,
      limit,
    });
  } catch (error) {
    return errorJson(error);
  }
}
