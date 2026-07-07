import { DEFAULT_ORG_ID, errorJson, json, supabaseAdmin, toStartup } from "@/server/supabase";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = supabaseAdmin();
    const [{ count: totalStartups }, { count: enrichedStartups }, { count: failedJobs }, { count: pendingJobs }, { data: startups }] =
      await Promise.all([
        db.from("startups").select("id", { count: "exact", head: true }).eq("org_id", DEFAULT_ORG_ID),
        db.from("startups").select("id", { count: "exact", head: true }).eq("org_id", DEFAULT_ORG_ID).not("last_enriched_at", "is", null),
        db.from("enrichment_jobs").select("id", { count: "exact", head: true }).eq("org_id", DEFAULT_ORG_ID).eq("status", "failed"),
        db.from("enrichment_jobs").select("id", { count: "exact", head: true }).eq("org_id", DEFAULT_ORG_ID).in("status", ["pending", "running"]),
        db.from("startups").select("*").eq("org_id", DEFAULT_ORG_ID).order("created_at", { ascending: false }).limit(200),
      ]);

    const rows = startups ?? [];
    return json({
      stats: {
        totalStartups: totalStartups ?? 0,
        enrichedStartups: enrichedStartups ?? 0,
        pendingJobs: pendingJobs ?? 0,
        failedJobs: failedJobs ?? 0,
        uploadedFiles: 0,
      },
      domainBreakdown: countBy(rows, "domain").map(([domain, count]) => ({ domain, count })),
      fundingBreakdown: countBy(rows, "funding_stage").map(([fundingStage, count]) => ({ fundingStage, count })),
      recentActivity: rows.slice(0, 8).map(toStartup),
    });
  } catch (error) {
    return errorJson(error);
  }
}

function countBy(items: any[], field: string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item[field] || "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}
