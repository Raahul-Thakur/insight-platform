import { Router, type IRouter } from "express";
import { enrichStartupViaWebSearch } from "../lib/webSearchAgent";

const router: IRouter = Router();

router.post("/web-enrichment/startup", async (req, res): Promise<void> => {
  const startup = req.body as {
    id?: unknown;
    name?: unknown;
    website?: unknown;
    linkedinUrl?: unknown;
    crunchbaseUrl?: unknown;
    tracxnUrl?: unknown;
    pocName?: unknown;
    pocEmail?: unknown;
  };

  if (typeof startup.id !== "number" || typeof startup.name !== "string" || !startup.name.trim()) {
    res.status(400).json({ error: "Startup id and name are required." });
    return;
  }

  try {
    const enriched = await enrichStartupViaWebSearch({
      id: startup.id,
      name: startup.name,
      website: typeof startup.website === "string" ? startup.website : null,
      linkedinUrl: typeof startup.linkedinUrl === "string" ? startup.linkedinUrl : null,
      crunchbaseUrl: typeof startup.crunchbaseUrl === "string" ? startup.crunchbaseUrl : null,
      tracxnUrl: typeof startup.tracxnUrl === "string" ? startup.tracxnUrl : null,
      pocName: typeof startup.pocName === "string" ? startup.pocName : null,
      pocEmail: typeof startup.pocEmail === "string" ? startup.pocEmail : null,
    });

    res.json(enriched);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Factual website enrichment failed";
    req.log.error({ err: error }, "Factual website enrichment failed");
    res.status(502).json({ error: message });
  }
});

export default router;
