import OpenAI from "openai";
import { cacheCrawlPage, getCachedCrawlPage } from "./appStore";
import { logger } from "./logger";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface EnrichedStartupData {
  domain: string | null;
  subdomain: string | null;
  hqLocation: string | null;
  country: string | null;
  fundingStage: string | null;
  totalFunding: string | null;
  employeeCount: number | null;
  founders: string[];
  investors: string[];
  description: string | null;
  websiteSummary: string | null;
  linkedinUrl: string | null;
  crunchbaseUrl: string | null;
  tracxnUrl: string | null;
  sources: Array<{
    sourceUrl: string | null;
    extractedField: string;
    extractedValue: string | null;
    confidenceScore: number;
  }>;
  overallConfidence: number;
}

interface StartupInput {
  id: number;
  name: string;
  website: string | null;
  linkedinUrl: string | null;
  crunchbaseUrl: string | null;
  tracxnUrl: string | null;
  pocName: string | null;
  pocEmail: string | null;
}

export async function enrichStartupViaWebSearch(
  startup: StartupInput,
): Promise<EnrichedStartupData> {
  const crawlContext = await getWebsiteContext(startup);
  const profileContext = await getOptionalProfileApiContext(startup);
  const identifiers = [
    startup.name,
    startup.website,
    startup.linkedinUrl,
    startup.crunchbaseUrl,
    startup.tracxnUrl,
  ]
    .filter(Boolean)
    .join(", ");

  const prompt = `You are a startup research analyst. Search the web to find detailed information about the following startup and return structured data.

Startup identifiers: ${identifiers}

Cached first-party website context:
${crawlContext || "No cached or crawlable website context available."}

Optional profile API context:
${profileContext || "No optional profile API context configured or available."}

Extract these fields:
1. Domain/Industry
2. Sub-domain
3. HQ location
4. Country
5. Funding stage
6. Total funding
7. Employee count
8. Founders
9. Investors
10. Description
11. Website summary
12. LinkedIn URL
13. Crunchbase URL
14. Tracxn URL

For each piece of information, include the source URL where it was found.

Return only JSON in this shape:
{
  "domain": "string or null",
  "subdomain": "string or null",
  "hqLocation": "string or null",
  "country": "string or null",
  "fundingStage": "string or null",
  "totalFunding": "string or null",
  "employeeCount": number or null,
  "founders": ["string"],
  "investors": ["string"],
  "description": "string or null",
  "websiteSummary": "string or null",
  "linkedinUrl": "string or null",
  "crunchbaseUrl": "string or null",
  "tracxnUrl": "string or null",
  "sources": [
    {
      "sourceUrl": "URL where data was found",
      "extractedField": "field name",
      "extractedValue": "value found",
      "confidenceScore": 0.0-1.0
    }
  ],
  "overallConfidence": 0.0-1.0
}

Be thorough. Use primary sources first, then credible secondary sources. Do not invent unavailable data.`;

  const response = await client.responses.create({
    model: "gpt-5.4-mini",
    max_output_tokens: 4096,
    tools: [{ type: "web_search_preview" }],
    input: prompt,
  });

  logger.info(
    { startupId: startup.id, responseId: response.id },
    "Web search agent response received",
  );

  const fullText = response.output_text;
  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn({ startupId: startup.id, fullText }, "No JSON found in web search response");
    return emptyResult();
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as EnrichedStartupData;
    return normalizeEnrichedData(parsed);
  } catch (err) {
    logger.error({ err, startupId: startup.id }, "Failed to parse web search JSON response");
    return emptyResult();
  }
}

async function getWebsiteContext(startup: StartupInput) {
  if (!startup.website) return "";
  const cached = getCachedCrawlPage(startup.website);
  if (cached) return truncateText(cached.text, 6000);

  try {
    const url = startup.website.startsWith("http") ? startup.website : `https://${startup.website}`;
    const response = await fetch(url, {
      headers: {
        "user-agent": "StartupIntelBot/1.0",
        accept: "text/html,text/plain",
      },
    });
    if (!response.ok) return "";
    const html = await response.text();
    const text = htmlToText(html);
    if (!text) return "";
    cacheCrawlPage({ url, title: startup.name, text });
    return truncateText(text, 6000);
  } catch (error) {
    logger.debug({ err: error, startupId: startup.id, website: startup.website }, "Website crawl skipped");
    return "";
  }
}

async function getOptionalProfileApiContext(startup: StartupInput) {
  const contexts = await Promise.all([
    fetchProfileApi("LinkedIn", process.env.LINKEDIN_API_URL, process.env.LINKEDIN_API_KEY, startup.linkedinUrl),
    fetchProfileApi("Crunchbase", process.env.CRUNCHBASE_API_URL, process.env.CRUNCHBASE_API_KEY, startup.crunchbaseUrl),
    fetchProfileApi("Tracxn", process.env.TRACXN_API_URL, process.env.TRACXN_API_KEY, startup.tracxnUrl),
  ]);
  return contexts.filter(Boolean).join("\n\n");
}

async function fetchProfileApi(
  label: string,
  endpoint: string | undefined,
  apiKey: string | undefined,
  profileUrl: string | null,
) {
  if (!endpoint || !apiKey || !profileUrl) return "";
  try {
    const url = new URL(endpoint);
    url.searchParams.set("url", profileUrl);
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
    });
    if (!response.ok) return "";
    const body = await response.text();
    return `${label} API response for ${profileUrl}:\n${truncateText(body, 4000)}`;
  } catch (error) {
    logger.debug({ err: error, label, profileUrl }, "Optional profile API lookup skipped");
    return "";
  }
}

function normalizeEnrichedData(parsed: EnrichedStartupData): EnrichedStartupData {
  return {
    domain: parsed.domain ?? null,
    subdomain: parsed.subdomain ?? null,
    hqLocation: parsed.hqLocation ?? null,
    country: parsed.country ?? null,
    fundingStage: parsed.fundingStage ?? null,
    totalFunding: parsed.totalFunding ?? null,
    employeeCount: typeof parsed.employeeCount === "number" ? parsed.employeeCount : null,
    founders: Array.isArray(parsed.founders) ? parsed.founders.filter((value) => typeof value === "string") : [],
    investors: Array.isArray(parsed.investors) ? parsed.investors.filter((value) => typeof value === "string") : [],
    description: parsed.description ?? null,
    websiteSummary: parsed.websiteSummary ?? null,
    linkedinUrl: parsed.linkedinUrl ?? null,
    crunchbaseUrl: parsed.crunchbaseUrl ?? null,
    tracxnUrl: parsed.tracxnUrl ?? null,
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    overallConfidence: typeof parsed.overallConfidence === "number" ? parsed.overallConfidence : 0.5,
  };
}

function emptyResult(): EnrichedStartupData {
  return {
    domain: null,
    subdomain: null,
    hqLocation: null,
    country: null,
    fundingStage: null,
    totalFunding: null,
    employeeCount: null,
    founders: [],
    investors: [],
    description: null,
    websiteSummary: null,
    linkedinUrl: null,
    crunchbaseUrl: null,
    tracxnUrl: null,
    sources: [],
    overallConfidence: 0,
  };
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, maxChars: number) {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}
