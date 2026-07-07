import { Router, type IRouter } from "express";
import healthRouter from "./health";
import startupsRouter from "./startups";
import dashboardRouter from "./dashboard";
import uploadRouter from "./upload";
import enrichmentRouter from "./enrichment";
import chatRouter from "./chat";
import webEnrichmentRouter from "./webEnrichment";
import groqChatRouter from "./groqChat";
import llmChatRouter from "./llmChat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(startupsRouter);
router.use(dashboardRouter);
router.use(uploadRouter);
router.use(enrichmentRouter);
router.use(chatRouter);
router.use(webEnrichmentRouter);
router.use(groqChatRouter);
router.use(llmChatRouter);

export default router;
