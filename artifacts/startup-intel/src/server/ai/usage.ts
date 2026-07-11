import { estimateCost } from "./config";

export type AiUsageEvent = {
  orgId: string;
  userId?: string | null;
  feature: string;
  routeType?: string | null;
  model?: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  embeddingTokens?: number;
  estimatedCost?: number;
  latencyMs?: number;
  cacheHit?: boolean;
  recordsRetrieved?: number;
  recordsSentToModel?: number;
  escalated?: boolean;
  escalationReason?: string | null;
  status?: string;
};

export async function logAiUsage(db: any, event: AiUsageEvent) {
  try {
    await db.from("ai_usage_logs").insert({
      org_id: event.orgId,
      tenant_id: event.orgId,
      user_id: event.userId ?? null,
      feature: event.feature,
      route_type: event.routeType ?? null,
      model: event.model ?? null,
      input_tokens: event.inputTokens ?? 0,
      cached_input_tokens: event.cachedInputTokens ?? 0,
      output_tokens: event.outputTokens ?? 0,
      embedding_tokens: event.embeddingTokens ?? 0,
      estimated_cost: event.estimatedCost ?? estimateCost(event.model, event.inputTokens, event.outputTokens),
      latency_ms: event.latencyMs ?? null,
      cache_hit: event.cacheHit ?? false,
      records_retrieved: event.recordsRetrieved ?? 0,
      records_sent_to_model: event.recordsSentToModel ?? 0,
      escalated: event.escalated ?? false,
      escalation_reason: event.escalationReason ?? null,
      status: event.status ?? "ok",
    });
  } catch {
    // Usage logging must never break product requests.
  }
}

export function roughTokenCount(value: string) {
  return Math.ceil(value.length / 4);
}
