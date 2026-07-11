export type AiModelPurpose = "router" | "extraction" | "answer" | "escalation" | "embedding";

export type ModelConfig = {
  routerModel: string;
  extractionModel: string;
  answerModel: string;
  escalationModel: string;
  embeddingModel: string;
};

export const AI_MODELS: ModelConfig = {
  routerModel: process.env.OPENAI_ROUTER_MODEL ?? "gpt-5.4-mini",
  extractionModel: process.env.OPENAI_EXTRACTION_MODEL ?? process.env.OPENAI_ENRICHMENT_MODEL ?? "gpt-5.4-mini",
  answerModel: process.env.OPENAI_ANSWER_MODEL ?? "gpt-5.4-mini",
  escalationModel: process.env.OPENAI_ESCALATION_MODEL ?? "gpt-5.4",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "local-hash-embedding-v1",
};

export const AI_LIMITS = {
  enrichmentBatchSize: Number(process.env.ENRICHMENT_BATCH_SIZE ?? 3),
  maxSourceChars: Number(process.env.AI_MAX_SOURCE_CHARS ?? 12000),
  maxPassageChars: Number(process.env.AI_MAX_PASSAGE_CHARS ?? 4000),
  maxRetrievedStartups: Number(process.env.AI_MAX_RETRIEVED_STARTUPS ?? 30),
  maxStartupsSentToModel: Number(process.env.AI_MAX_STARTUPS_SENT_TO_MODEL ?? 10),
  recentMessages: Number(process.env.AI_RECENT_MESSAGES ?? 6),
};

export const MODEL_PRICING_USD_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-5.4-mini": { input: Number(process.env.PRICE_GPT54_MINI_INPUT ?? 0), output: Number(process.env.PRICE_GPT54_MINI_OUTPUT ?? 0) },
  "gpt-5.4": { input: Number(process.env.PRICE_GPT54_INPUT ?? 0), output: Number(process.env.PRICE_GPT54_OUTPUT ?? 0) },
};

export type RefreshPolicyDays = number | null | "on_source_change";

export const ENRICHMENT_REFRESH_POLICY: Record<string, RefreshPolicyDays> = {
  name: null,
  website: 180,
  domain: 180,
  subdomain: 180,
  hq_location: 365,
  country: 365,
  funding_stage: 30,
  total_funding: 30,
  employee_count: 60,
  founders: 180,
  investors: 90,
  description: "on_source_change",
  website_summary: "on_source_change",
  linkedin_url: 180,
  crunchbase_url: 180,
  tracxn_url: 180,
};

export function estimateCost(model: string | null | undefined, inputTokens = 0, outputTokens = 0) {
  const pricing = model ? MODEL_PRICING_USD_PER_1K[model] : undefined;
  if (!pricing) return 0;
  return Number((((inputTokens / 1000) * pricing.input) + ((outputTokens / 1000) * pricing.output)).toFixed(6));
}
