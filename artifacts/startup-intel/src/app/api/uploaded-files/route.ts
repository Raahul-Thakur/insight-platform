import { DEFAULT_ORG_ID, errorJson, json, supabaseAdmin } from "@/server/supabase";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("uploaded_files")
      .select("*")
      .eq("org_id", DEFAULT_ORG_ID)
      .order("uploaded_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return json((data ?? []).map((file: any) => ({
      id: file.id,
      filename: file.original_filename,
      rowCount: file.row_count,
      status: file.status,
      uploadedAt: file.uploaded_at,
    })));
  } catch (error) {
    return errorJson(error);
  }
}
