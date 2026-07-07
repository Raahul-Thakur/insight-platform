import { Router, type IRouter } from "express";
import {
  GetDashboardStatsResponse,
  GetDomainBreakdownResponse,
  GetFundingBreakdownResponse,
  GetRecentActivityResponse,
} from "@workspace/api-zod";
import {
  getBreakdown,
  getDashboardStats,
  getRecentActivity,
} from "../lib/appStore";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  res.json(GetDashboardStatsResponse.parse(getDashboardStats()));
});

router.get("/dashboard/domain-breakdown", async (_req, res): Promise<void> => {
  res.json(GetDomainBreakdownResponse.parse(getBreakdown("domain")));
});

router.get("/dashboard/funding-breakdown", async (_req, res): Promise<void> => {
  res.json(GetFundingBreakdownResponse.parse(getBreakdown("fundingStage")));
});

router.get("/dashboard/recent-activity", async (_req, res): Promise<void> => {
  res.json(GetRecentActivityResponse.parse(getRecentActivity()));
});

export default router;
