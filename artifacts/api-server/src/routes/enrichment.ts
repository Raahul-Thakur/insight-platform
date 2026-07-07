import { Router, type IRouter } from "express";
import {
  ListEnrichmentJobsQueryParams,
  ListEnrichmentJobsResponse,
} from "@workspace/api-zod";
import { listEnrichmentJobs } from "../lib/appStore";

const router: IRouter = Router();

router.get("/enrichment-jobs", async (req, res): Promise<void> => {
  const parsed = ListEnrichmentJobsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  res.json(ListEnrichmentJobsResponse.parse(listEnrichmentJobs(parsed.data)));
});

export default router;
