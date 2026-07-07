import { Router, type IRouter } from "express";
import {
  ChatQueryBody,
  ChatQueryResponse,
  GetChatHistoryResponse,
} from "@workspace/api-zod";
import {
  createCachedQuery,
  findCachedQuery,
  listChatHistory,
  queryStartups,
  type ParsedFilters,
} from "../lib/appStore";

const router: IRouter = Router();

function parseFilters(query: string): ParsedFilters {
  const q = query.toLowerCase();

  const fundingKeywords: Record<string, string> = {
    "pre-seed": "Pre-Seed",
    preseed: "Pre-Seed",
    seed: "Seed",
    "series a": "Series A",
    "series b": "Series B",
    "series c": "Series C",
    "series d": "Series D",
    "series e": "Series E",
    growth: "Growth",
    ipo: "IPO",
    bootstrapped: "Bootstrapped",
    "venture funded": "Venture",
  };

  const domainKeywords: Record<string, string> = {
    fintech: "Fintech",
    "financial technology": "Fintech",
    "ai/ml": "AI/ML",
    "machine learning": "AI/ML",
    "artificial intelligence": "AI/ML",
    " ai ": "AI/ML",
    "climate tech": "Climate Tech",
    climate: "Climate Tech",
    cleantech: "CleanTech",
    healthtech: "HealthTech",
    health: "HealthTech",
    edtech: "EdTech",
    education: "EdTech",
    saas: "SaaS",
    "e-commerce": "E-commerce",
    ecommerce: "E-commerce",
    logistics: "Logistics",
    "deep tech": "DeepTech",
    deeptech: "DeepTech",
    crypto: "Crypto/Web3",
    blockchain: "Crypto/Web3",
    web3: "Crypto/Web3",
    agritech: "AgriTech",
    proptech: "PropTech",
    cybersecurity: "Cybersecurity",
    security: "Cybersecurity",
  };

  const locationKeywords = [
    "bangalore",
    "bengaluru",
    "mumbai",
    "delhi",
    "hyderabad",
    "chennai",
    "pune",
    "kolkata",
    "gurgaon",
    "noida",
    "san francisco",
    "new york",
    "london",
    "singapore",
    "dubai",
    "berlin",
    "paris",
    "toronto",
    "sydney",
    "tokyo",
  ];

  const empMatch = q.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(employees?|people|team)/);
  const investorMatch = q.match(/(?:investor|investors|backed by|funded by)\s+([a-z0-9 .&-]+)/i);
  const stopWords = new Set([
    "show",
    "find",
    "get",
    "me",
    "in",
    "at",
    "the",
    "a",
    "an",
    "startups",
    "startup",
    "companies",
    "company",
    "based",
    "with",
    "and",
    "or",
    "stage",
    "funding",
    "give",
    "list",
  ]);

  const fundingStage = findKeyword(q, fundingKeywords);
  const domain = findKeyword(q, domainKeywords);
  const location = locationKeywords.find((loc) => q.includes(loc));
  const keyword = query
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word.toLowerCase()))
    .slice(0, 3)
    .join(" ");

  return {
    domain,
    fundingStage,
    location: location ? titleCase(location) : null,
    country: null,
    keyword: keyword || null,
    employeeCountMin: empMatch ? parseInt(empMatch[1]!, 10) : null,
    employeeCountMax: empMatch ? parseInt(empMatch[2]!, 10) : null,
    investor: investorMatch ? investorMatch[1]!.trim() : null,
  };
}

router.post("/chat", async (req, res): Promise<void> => {
  const startTime = Date.now();
  const parsed = ChatQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query } = parsed.data;
  const normalizedQuery = query.trim().toLowerCase();
  const cached = findCachedQuery(normalizedQuery);
  const filters = cached?.parsedFilters ?? parseFilters(query);
  const startups = queryStartups(filters, { semanticQuery: query });
  const processingMs = Date.now() - startTime;

  if (!cached) {
    createCachedQuery({
      queryText: query,
      normalizedQuery,
      parsedFilters: filters,
      resultStartupIds: startups.map((startup) => startup.id),
      resultCount: startups.length,
      queryType: hasStructuredFilters(filters) ? "exact" : "semantic",
    });
  }

  req.log.info({ query, cacheHit: Boolean(cached), processingMs, results: startups.length }, "Chat query");

  res.json(
    ChatQueryResponse.parse({
      query,
      parsedFilters: filters,
      startups,
      totalMatched: startups.length,
      cacheHit: Boolean(cached),
      processingMs,
      message: startups.length === 0 ? "No startups found matching your query. Try broadening your search." : null,
    }),
  );
});

router.get("/chat/history", async (_req, res): Promise<void> => {
  res.json(GetChatHistoryResponse.parse(listChatHistory()));
});

function findKeyword(query: string, keywords: Record<string, string>) {
  for (const [keyword, value] of Object.entries(keywords)) {
    if (query.includes(keyword)) return value;
  }
  return null;
}

function titleCase(value: string) {
  return value
    .split(" ")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

function hasStructuredFilters(filters: ParsedFilters) {
  return Boolean(
    filters.domain ||
      filters.fundingStage ||
      filters.location ||
      filters.country ||
      filters.employeeCountMin != null ||
      filters.employeeCountMax != null ||
      filters.investor,
  );
}

export default router;
