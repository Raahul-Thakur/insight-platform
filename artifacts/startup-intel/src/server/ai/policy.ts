import { AI_LIMITS, AI_MODELS, estimateCost } from "./config";

export type IntelligenceTask = "company_intelligence";

export const AI_GUARDRAILS = {
  maxCallsPerEnrichment: bounded("MAX_LLM_CALLS_PER_ENRICHMENT", 1, 0, 4),
  maxExpensiveCalls: bounded("MAX_EXPENSIVE_LLM_CALLS", 0, 0, 2),
  maxInputTokens: bounded("MAX_LLM_INPUT_TOKENS", 3000, 250, 20000),
  maxOutputTokens: bounded("MAX_LLM_OUTPUT_TOKENS", 700, 100, 4000),
  maxEstimatedCost: bounded("MAX_ESTIMATED_AI_COST", 0.05, 0, 10),
};

export function decideAiEscalation(input: { requested: boolean; factualOnly: boolean; callsUsed: number; expensiveCallsUsed: number; estimatedCost: number; strongModelNeeded?: boolean }) {
  if (!input.requested || input.factualOnly) return { allowed: false, reason: "intelligence_not_requested", model: null } as const;
  if (!process.env.OPENAI_API_KEY) return { allowed: false, reason: "provider_not_configured", model: null } as const;
  if (input.callsUsed >= AI_GUARDRAILS.maxCallsPerEnrichment) return { allowed: false, reason: "call_budget_exhausted", model: null } as const;
  if (input.strongModelNeeded && input.expensiveCallsUsed >= AI_GUARDRAILS.maxExpensiveCalls) return { allowed: false, reason: "expensive_call_budget_exhausted", model: null } as const;
  const model = input.strongModelNeeded ? AI_MODELS.escalationModel : AI_MODELS.extractionModel;
  const projectedCost = input.estimatedCost + estimateCost(model, AI_GUARDRAILS.maxInputTokens, AI_GUARDRAILS.maxOutputTokens);
  if (projectedCost > AI_GUARDRAILS.maxEstimatedCost) return { allowed: false, reason: "cost_budget_exhausted", model: null } as const;
  return { allowed: true, reason: input.strongModelNeeded ? "reasoning_requires_strong_model" : "explicit_intelligence_request", model } as const;
}

export function compactIntelligenceEvidence(startup: any, evidence: Array<{ field: string; value: unknown; sourceUrl: string }>) {
  const payload = JSON.stringify({
    company: { name: startup.name, website: startup.website },
    observedFacts: evidence.slice(0, 30).map((item) => ({ field: item.field, value: item.value, sourceUrl: item.sourceUrl })),
  });
  return payload.slice(0, Math.min(AI_LIMITS.maxSourceChars, AI_GUARDRAILS.maxInputTokens * 4));
}

function bounded(name: string, fallback: number, min: number, max: number) { const value = Number(process.env[name] ?? fallback); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
