import { Router, type IRouter } from "express";
import Groq from "groq-sdk";

const GROQ_MODEL = "llama-3.1-8b-instant";
const MAX_STARTUPS_PER_QUERY = 45;
const MAX_TEXT_FIELD_CHARS = 160;

const router: IRouter = Router();

type ChatStartup = {
  id: number;
  name: string;
  website?: string | null;
  domain?: string | null;
  subdomain?: string | null;
  hqLocation?: string | null;
  country?: string | null;
  fundingStage?: string | null;
  totalFunding?: string | null;
  employeeCount?: number | null;
  description?: string | null;
  websiteSummary?: string | null;
};

router.get("/groq-chat/status", async (req, res): Promise<void> => {
  const groqApiKey = getGroqApiKey();
  if (!groqApiKey) {
    res.status(400).json({ configured: false });
    return;
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });
    const models = await groq.models.list();
    const hasChatModel = models.data.some((model) => model.id === GROQ_MODEL);

    req.log.info(
      {
        keyPrefix: groqApiKey.slice(0, 4),
        keySuffix: groqApiKey.slice(-4),
        keyLength: groqApiKey.length,
      },
      "Groq key status checked",
    );

    res.json({
      configured: true,
      ok: true,
      status: 200,
      hasChatModel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Groq status check failed";
    req.log.warn({ err: error }, "Groq key status check failed");
    res.status(502).json({
      configured: true,
      ok: false,
      status: 502,
      hasChatModel: false,
      error: message,
    });
  }
});

router.post("/groq-chat/query", async (req, res): Promise<void> => {
  const groqApiKey = getGroqApiKey();
  if (!groqApiKey) {
    res.status(400).json({
      error:
        "GROQ_API_KEY is not configured with a valid Groq key. Create one at https://console.groq.com/keys and add it to .env.",
    });
    return;
  }

  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  const startups = Array.isArray(req.body?.startups) ? (req.body.startups as ChatStartup[]) : [];

  if (!query) {
    res.status(400).json({ error: "Query is required." });
    return;
  }

  try {
    const candidateStartups = selectCandidateStartups(query, startups);
    const groq = new Groq({ apiKey: groqApiKey });
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a startup database query assistant. Return only valid JSON. Match companies from the supplied list to the user's query. Do not invent company IDs.",
        },
        {
          role: "user",
          content: JSON.stringify({
            query,
            startups: candidateStartups.map(compactStartup),
            expectedJson: {
              matchedIds: ["number[] of startup IDs that match the query"],
              parsedFilters: {
                domain: "string or null",
                fundingStage: "string or null",
                location: "string or null",
                country: "string or null",
                keyword: "string or null",
                employeeCountMin: "number or null",
                employeeCountMax: "number or null",
                investor: "string or null",
              },
              answer: "one short sentence explaining the match criteria",
            },
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message.content ?? "{}";
    const parsed = JSON.parse(content) as {
      matchedIds?: unknown;
      parsedFilters?: Record<string, unknown>;
      answer?: unknown;
    };

    const parsedFilters = normalizeFilters(parsed.parsedFilters);
    const matchedIds = Array.isArray(parsed.matchedIds)
      ? parsed.matchedIds
          .map(coerceId)
          .filter((id): id is number => id !== null)
      : [];
    const fallbackIds =
      matchedIds.length > 0 ? matchedIds : matchStartupsByFilters(startups, parsedFilters, query);

    res.json({
      model: GROQ_MODEL,
      candidateCount: candidateStartups.length,
      matchedIds: fallbackIds,
      parsedFilters,
      answer: typeof parsed.answer === "string" ? parsed.answer : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Groq chat query failed";
    req.log.error({ err: error }, "Groq chat query failed");
    res.status(502).json({ error: message });
  }
});

function getGroqApiKey() {
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  if (!groqApiKey || groqApiKey === "gsk_..." || !groqApiKey.startsWith("gsk_")) {
    return null;
  }
  return groqApiKey;
}

function compactStartup(startup: ChatStartup) {
  return {
    id: startup.id,
    name: truncate(startup.name, 80),
    domain: truncate(startup.domain, 60),
    subdomain: truncate(startup.subdomain, 60),
    location: truncate(startup.hqLocation ?? startup.country, 80),
    stage: truncate(startup.fundingStage, 40),
    funding: truncate(startup.totalFunding, 40),
    employeeCount: startup.employeeCount ?? null,
    summary: truncate(startup.description ?? startup.websiteSummary, MAX_TEXT_FIELD_CHARS),
  };
}

function selectCandidateStartups(query: string, startups: ChatStartup[]) {
  const tokens = tokenize(query);
  const scored = startups.map((startup, index) => ({
    startup,
    index,
    score: scoreStartup(startup, tokens),
  }));

  const matching = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_STARTUPS_PER_QUERY);

  if (matching.length > 0) {
    return matching.map((item) => item.startup);
  }

  return startups.slice(0, Math.min(25, MAX_STARTUPS_PER_QUERY));
}

function scoreStartup(startup: ChatStartup, tokens: string[]) {
  const weightedFields: Array<[string | null | undefined, number]> = [
    [startup.name, 5],
    [startup.domain, 4],
    [startup.subdomain, 3],
    [startup.fundingStage, 3],
    [startup.hqLocation, 3],
    [startup.country, 2],
    [startup.totalFunding, 1],
    [startup.website, 1],
    [startup.description, 1],
    [startup.websiteSummary, 1],
  ];

  let score = 0;
  for (const token of tokens) {
    for (const [field, weight] of weightedFields) {
      if (field?.toLowerCase().includes(token)) {
        score += weight;
      }
    }
  }
  return score;
}

function tokenize(value: string) {
  const stopWords = new Set([
    "show",
    "find",
    "list",
    "give",
    "startups",
    "startup",
    "companies",
    "company",
    "with",
    "and",
    "the",
    "for",
    "are",
    "that",
    "from",
  ]);

  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function truncate(value: string | null | undefined, maxChars: number) {
  if (!value) return null;
  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
}

function normalizeFilters(filters: Record<string, unknown> | undefined) {
  return {
    domain: stringOrNull(filters?.domain),
    fundingStage: stringOrNull(filters?.fundingStage),
    location: stringOrNull(filters?.location),
    country: stringOrNull(filters?.country),
    keyword: stringOrNull(filters?.keyword),
    employeeCountMin: numberOrNull(filters?.employeeCountMin),
    employeeCountMax: numberOrNull(filters?.employeeCountMax),
    investor: stringOrNull(filters?.investor),
  };
}

function matchStartupsByFilters(
  startups: ChatStartup[],
  filters: ReturnType<typeof normalizeFilters>,
  query: string,
) {
  const fallbackTokens = tokenize(query);
  return startups
    .filter((startup) => {
      if (filters.domain && !contains(startup.domain, filters.domain)) return false;
      if (filters.fundingStage && !contains(startup.fundingStage, filters.fundingStage)) return false;
      if (
        filters.location &&
        !contains(startup.hqLocation, filters.location) &&
        !contains(startup.country, filters.location)
      ) {
        return false;
      }
      if (filters.country && !contains(startup.country, filters.country)) return false;
      if (filters.employeeCountMin != null && (startup.employeeCount ?? 0) < filters.employeeCountMin) {
        return false;
      }
      if (filters.employeeCountMax != null && (startup.employeeCount ?? 0) > filters.employeeCountMax) {
        return false;
      }
      if (filters.keyword && !startupHasToken(startup, filters.keyword)) return false;

      const hasExplicitFilter = Object.values(filters).some((value) => value !== null);
      return hasExplicitFilter || fallbackTokens.some((token) => startupHasToken(startup, token));
    })
    .map((startup) => startup.id);
}

function coerceId(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function contains(value: string | null | undefined, query: string) {
  return normalizeText(value).includes(normalizeText(query));
}

function startupHasToken(startup: ChatStartup, token: string) {
  return [
    startup.name,
    startup.website,
    startup.domain,
    startup.subdomain,
    startup.hqLocation,
    startup.country,
    startup.fundingStage,
    startup.totalFunding,
    startup.description,
    startup.websiteSummary,
  ]
    .map(normalizeText)
    .some((field) => field.includes(normalizeText(token)));
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default router;
