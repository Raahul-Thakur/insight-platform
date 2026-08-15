import crypto from "node:crypto";

/** Compact deterministic profile text used by local retrieval, never as factual generation input. */
export function buildSearchDocument(startup: any) {
  return [
    startup.name,
    startup.website,
    startup.domain,
    startup.subdomain,
    startup.hq_location,
    startup.country,
    startup.funding_stage,
    startup.total_funding,
    startup.employee_count ? `${startup.employee_count} employees` : null,
    ...(startup.founders ?? []),
    ...(startup.investors ?? []),
    startup.description,
    startup.website_summary,
  ].filter(Boolean).join("\n").slice(0, 4000);
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
