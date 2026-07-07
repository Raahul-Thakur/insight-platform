import { NextRequest } from "next/server";
import { DEFAULT_ORG_ID, errorJson, json, supabaseAdmin, toStartup } from "@/server/supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const params = request.nextUrl.searchParams;
    const page = Number(params.get("page") ?? "1");
    const limit = Number(params.get("limit") ?? "20");
    const keyword = params.get("keyword")?.trim();
    const status = params.get("enrichmentStatus")?.trim();
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = db
      .from("startups")
      .select("*", { count: "exact" })
      .eq("org_id", DEFAULT_ORG_ID)
      .order("created_at", { ascending: false });

    if (keyword) {
      query = query.or(
        [
          `name.ilike.%${keyword}%`,
          `website.ilike.%${keyword}%`,
          `domain.ilike.%${keyword}%`,
          `hq_location.ilike.%${keyword}%`,
          `funding_stage.ilike.%${keyword}%`,
        ].join(","),
      );
    }

    if (status === "enriched") query = query.not("last_enriched_at", "is", null);
    if (status === "missing") {
      query = query.or("domain.is.null,funding_stage.is.null,hq_location.is.null");
    }

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;

    return json({
      startups: (data ?? []).map(toStartup),
      total: count ?? 0,
      page,
      limit,
    });
  } catch (error) {
    return errorJson(error);
  }
}
