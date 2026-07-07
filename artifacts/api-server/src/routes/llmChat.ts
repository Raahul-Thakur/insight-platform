import OpenAI from "openai";
import { Router, type IRouter } from "express";

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

const router: IRouter = Router();

router.post("/chat/llm-query", async (req, res): Promise<void> => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  const startups = Array.isArray(req.body?.startups) ? (req.body.startups as ChatStartup[]) : [];

  if (!query) {
    res.status(400).json({ error: "Query is required." });
    return;
  }

  if (startups.length === 0) {
    res.json({
      answer: "No startups are available yet. Import a CSV first.",
      parsedFilters: {},
      matchedStartupIds: [],
    });
    return;
  }

  const provider = (process.env.CHAT_MODEL_PROVIDER ?? "groq").toLowerCase();
  const config = getProviderConfig(provider);
  if (!config.apiKey) {
    res.status(400).json({ error: `${config.apiKeyName} is not configured on the API server.` });
    return;
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You answer questions about a startup registry. Return only valid JSON with keys: answer, parsedFilters, matchedStartupIds. matchedStartupIds must contain only ids from the provided startups. Prefer precise matches over broad matches.",
        },
        {
          role: "user",
          content: JSON.stringify({
            query,
            startups: startups.slice(0, 500).map((startup) => ({
              id: startup.id,
              name: startup.name,
              website: startup.website,
              domain: startup.domain,
              subdomain: startup.subdomain,
              hqLocation: startup.hqLocation,
              country: startup.country,
              fundingStage: startup.fundingStage,
              totalFunding: startup.totalFunding,
              employeeCount: startup.employeeCount,
              description: startup.description,
              websiteSummary: startup.websiteSummary,
            })),
          }),
        },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as {
      answer?: unknown;
      parsedFilters?: unknown;
      matchedStartupIds?: unknown;
    };

    res.json({
      answer: typeof parsed.answer === "string" ? parsed.answer : "",
      parsedFilters: isRecord(parsed.parsedFilters) ? parsed.parsedFilters : {},
      matchedStartupIds: Array.isArray(parsed.matchedStartupIds)
        ? parsed.matchedStartupIds.filter((id) => typeof id === "number")
        : [],
      provider,
      model: config.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat model query failed";
    req.log.error({ err: error }, "Chat model query failed");
    res.status(502).json({ error: message });
  }
});

function getProviderConfig(provider: string) {
  if (provider === "xai" || provider === "grok") {
    return {
      apiKey: process.env.XAI_API_KEY,
      apiKeyName: "XAI_API_KEY",
      baseURL: "https://api.x.ai/v1",
      model: process.env.XAI_MODEL ?? "grok-4.3",
    };
  }

  return {
    apiKey: process.env.GROQ_API_KEY,
    apiKeyName: "GROQ_API_KEY",
    baseURL: "https://api.groq.com/openai/v1",
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default router;
