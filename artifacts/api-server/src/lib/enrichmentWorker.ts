import {
  addStartupSources,
  applyEnrichmentToStartup,
  getEnrichmentJob,
  getPendingJobs,
  getStartup,
  updateEnrichmentJob,
} from "./appStore";
import { logger } from "./logger";
import { enrichStartupViaWebSearch } from "./webSearchAgent";

const WORKER_INTERVAL_MS = 10_000;
const MAX_CONCURRENT_JOBS = 2;

let isRunning = false;

async function processJob(jobId: number): Promise<void> {
  updateEnrichmentJob(jobId, { status: "running" });

  const job = getEnrichmentJob(jobId);
  if (!job) return;

  const startup = getStartup(job.startupId);
  if (!startup) {
    updateEnrichmentJob(jobId, {
      status: "failed",
      errorMessage: "Startup not found",
      completedAt: new Date().toISOString(),
    });
    return;
  }

  try {
    logger.info({ jobId, startupId: startup.id, name: startup.name }, "Starting web search enrichment");

    const enriched = await enrichStartupViaWebSearch({
      id: startup.id,
      name: startup.name,
      website: startup.website,
      linkedinUrl: startup.linkedinUrl,
      crunchbaseUrl: startup.crunchbaseUrl,
      tracxnUrl: startup.tracxnUrl,
      pocName: startup.pocName,
      pocEmail: startup.pocEmail,
    });

    if (enriched.sources.length > 0) {
      addStartupSources(
        enriched.sources.map((source) => ({
          startupId: startup.id,
          sourceType: "web_search",
          sourceUrl: source.sourceUrl,
          extractedField: source.extractedField,
          extractedValue: source.extractedValue,
          confidenceScore: source.confidenceScore,
          lastCheckedAt: new Date().toISOString(),
        })),
      );
    }

    applyEnrichmentToStartup(startup.id, {
      domain: enriched.domain,
      subdomain: enriched.subdomain,
      hqLocation: enriched.hqLocation,
      country: enriched.country,
      fundingStage: enriched.fundingStage,
      totalFunding: enriched.totalFunding,
      employeeCount: enriched.employeeCount,
      founders: enriched.founders,
      investors: enriched.investors,
      description: enriched.description,
      websiteSummary: enriched.websiteSummary,
      linkedinUrl: enriched.linkedinUrl,
      crunchbaseUrl: enriched.crunchbaseUrl,
      tracxnUrl: enriched.tracxnUrl,
      confidenceScore: enriched.overallConfidence,
      overallConfidence: enriched.overallConfidence,
    });

    updateEnrichmentJob(jobId, {
      status: "completed",
      completedAt: new Date().toISOString(),
    });

    logger.info(
      { jobId, startupId: startup.id, confidence: enriched.overallConfidence },
      "Enrichment job completed",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    updateEnrichmentJob(jobId, {
      status: "failed",
      errorMessage: message,
      completedAt: new Date().toISOString(),
    });

    logger.error({ err, jobId }, "Enrichment job failed");
  }
}

async function tick(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    const pendingJobs = getPendingJobs(MAX_CONCURRENT_JOBS);
    if (pendingJobs.length > 0) {
      logger.debug({ count: pendingJobs.length }, "Processing enrichment jobs");
      await Promise.all(pendingJobs.map((job) => processJob(job.id)));
    }
  } catch (err) {
    logger.error({ err }, "Enrichment worker tick error");
  } finally {
    isRunning = false;
  }
}

export function startEnrichmentWorker(): void {
  logger.info("Enrichment worker started with durable app storage");
  void tick();
  setInterval(() => void tick(), WORKER_INTERVAL_MS);
}
