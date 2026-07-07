import { Router, type IRouter } from "express";
import {
  GetStartupParams,
  GetStartupResponse,
  ListStartupsQueryParams,
  ListStartupsResponse,
  TriggerEnrichmentParams,
  TriggerEnrichmentResponse,
} from "@workspace/api-zod";
import {
  createEnrichmentJob,
  getStartup,
  getStartupDetail,
  listStartups,
} from "../lib/appStore";

const router: IRouter = Router();

router.get("/startups", async (req, res): Promise<void> => {
  const parsed = ListStartupsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  res.json(ListStartupsResponse.parse(listStartups(parsed.data)));
});

router.get("/startups/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetStartupParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const detail = getStartupDetail(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Startup not found" });
    return;
  }

  res.json(GetStartupResponse.parse(detail));
});

router.post("/startups/:id/enrich", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = TriggerEnrichmentParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const startup = getStartup(params.data.id);
  if (!startup) {
    res.status(404).json({ error: "Startup not found" });
    return;
  }

  const job = createEnrichmentJob(startup.id);
  req.log.info({ jobId: job.id, startupId: startup.id }, "Enrichment job created");

  res.status(202).json(
    TriggerEnrichmentResponse.parse({
      ...job,
      startupName: startup.name,
    }),
  );
});

export default router;
