const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "company", "co", "llc", "ltd", "limited", "plc", "pvt", "private",
]);

export function normalizeCompanyName(name: string): string {
  const words = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

export function normalizeDomain(input: string | null | undefined): string | null {
  const value = input?.trim();
  if (!value || value.toLowerCase() === "https://unknown.com" || value.toLowerCase() === "unknown.com") return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return hostname && hostname.includes(".") ? hostname : null;
  } catch {
    return null;
  }
}

export function canonicalWebsite(input: string | null | undefined): string | null {
  const domain = normalizeDomain(input);
  return domain ? `https://${domain}` : null;
}

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

export function sameCompanyIdentity(
  left: { name?: string | null; website?: string | null; canonicalDomain?: string | null },
  right: { name?: string | null; website?: string | null; canonicalDomain?: string | null },
): boolean {
  const leftDomain = normalizeDomain(left.canonicalDomain ?? left.website);
  const rightDomain = normalizeDomain(right.canonicalDomain ?? right.website);
  if (leftDomain && rightDomain) return leftDomain === rightDomain;
  if (leftDomain || rightDomain) return false;
  const leftName = normalizeCompanyName(left.name ?? "");
  const rightName = normalizeCompanyName(right.name ?? "");
  return Boolean(leftName && rightName && leftName === rightName);
}
