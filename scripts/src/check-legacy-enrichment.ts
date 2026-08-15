import fs from "node:fs";

const config = new Map<string, string>();
for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match) config.set(match[1]!, match[2]!.trim());
}
const baseUrl = config.get("SUPABASE_URL");
const key = config.get("SUPABASE_SERVICE_ROLE_KEY");
if (!baseUrl || !key) {
  process.stdout.write("NO_SUPABASE_CONFIG\n");
  process.exit(0);
}
const url = new URL("/rest/v1/startups", baseUrl);
url.searchParams.set("select", "id,name,website,last_enriched_at,domain,hq_location,country,description");
url.searchParams.set("last_enriched_at", "not.is.null");
url.searchParams.set("order", "last_enriched_at.desc");
url.searchParams.set("limit", "1");
const response = await fetch(url, {
  headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/json", "user-agent": "StartupIntelServerValidation/1.0" },
});
if (!response.ok) {
  process.stdout.write(`LEGACY_QUERY_UNAVAILABLE HTTP ${response.status}\n`);
  process.exit(0);
}
const body = await response.json();
process.stdout.write(`${JSON.stringify(body)}\n`);
