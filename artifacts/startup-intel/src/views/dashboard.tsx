"use client";

import { type KeyboardEvent, type MouseEvent, type ReactNode, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from "recharts";
import { Activity, Database, AlertCircle, Clock, Zap, UploadCloud, ArrowRight, Loader2, MessageSquare, CheckCircle } from "lucide-react";
import Link from "next/link";
import { ChatPanel } from "@/components/chat-panel";
import { StartupRegistry } from "@/components/startup-registry";
import { enrichAllStartups, getDashboardData, listEnrichmentJobs, useLocalStoreVersion } from "@/lib/local-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const [isRegistryOpen, setIsRegistryOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [jobLogModal, setJobLogModal] = useState<"completed" | "failed" | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    completed: number;
    total: number;
    failed: number;
    currentName: string;
  } | null>(null);
  const { toast } = useToast();
  useLocalStoreVersion();
  const { stats, domainBreakdown, fundingBreakdown, recentActivity } = getDashboardData();
  const completedJobs = listEnrichmentJobs({ page: 1, limit: 4, status: "completed" }).jobs;
  const failedJobs = listEnrichmentJobs({ page: 1, limit: 4, status: "failed" }).jobs;
  const allCompletedJobs = listEnrichmentJobs({ page: 1, limit: 10000, status: "completed" });
  const allFailedJobs = listEnrichmentJobs({ page: 1, limit: 10000, status: "failed" });
  const statsLoading = false;
  const domainsLoading = false;
  const fundingLoading = false;
  const activityLoading = false;

  const isEmpty = !statsLoading && stats.totalStartups === 0;
  const isBulkEnriching = bulkProgress !== null;
  const remainingToEnrich = Math.max(0, stats.totalStartups - stats.enrichedStartups);

  const handleBulkEnrich = async () => {
    setBulkProgress({ completed: 0, total: remainingToEnrich, failed: 0, currentName: "" });
    try {
      const result = await enrichAllStartups(setBulkProgress);
      toast({
        title: "Bulk enrichment complete",
        description: `Enriched ${result.completed} of ${result.total}. Failed: ${result.failed}.`,
        variant: result.failed > 0 ? "destructive" : "default",
      });
    } finally {
      setBulkProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold font-mono text-foreground uppercase tracking-tight">System_Overview</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">Real-time metrics and startup intelligence flow</p>
        </div>
        {!isEmpty && (
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Button
              onClick={handleBulkEnrich}
              disabled={isBulkEnriching || remainingToEnrich === 0}
              className="font-mono uppercase tracking-wider"
            >
              {isBulkEnriching ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              Enrich All Missing
            </Button>
            <p className="text-xs font-mono text-muted-foreground">
              {isBulkEnriching && bulkProgress
                ? `${bulkProgress.completed}/${bulkProgress.total} complete, ${bulkProgress.failed} failed${bulkProgress.currentName ? ` - ${bulkProgress.currentName}` : ""}`
                : remainingToEnrich === 0
                  ? "All profiles are enriched"
                  : `${remainingToEnrich} profiles need enrichment`}
            </p>
          </div>
        )}
      </div>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {/* Top Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Startups"
              value={stats.totalStartups}
              loading={statsLoading}
              icon={<Database className="w-4 h-4 text-primary" />}
              trend="All tracked entities"
              onClick={() => setIsRegistryOpen(true)}
            />
            <StatCard
              title="Enriched Profiles"
              value={stats.enrichedStartups}
              loading={statsLoading}
              icon={<Zap className="w-4 h-4 text-chart-2" />}
              trend={`${Math.round((stats.enrichedStartups / (stats.totalStartups || 1)) * 100)}% coverage`}
              onClick={() => setJobLogModal("completed")}
            >
              <JobLogList jobs={completedJobs} emptyText="No successful enrichment runs yet" tone="success" />
            </StatCard>
            <StatCard
              title="Pending Jobs"
              value={stats.pendingJobs}
              loading={statsLoading}
              icon={<Clock className="w-4 h-4 text-chart-3" />}
              trend="Queue active"
            />
            <StatCard
              title="Failed Jobs"
              value={stats.failedJobs}
              loading={statsLoading}
              icon={<AlertCircle className="w-4 h-4 text-destructive" />}
              trend="Needs review"
              onClick={() => setJobLogModal("failed")}
            >
              <JobLogList jobs={failedJobs} emptyText="No failed enrichment runs" tone="failed" />
            </StatCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Charts */}
            <div className="lg:col-span-2 flex flex-col gap-6">
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Domain Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[250px] w-full">
                    {domainsLoading ? (
                      <Skeleton className="w-full h-full" />
                    ) : domainBreakdown && domainBreakdown.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={domainBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                          <XAxis dataKey="domain" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval={0} angle={-45} textAnchor="end" />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                          <RechartsTooltip
                            cursor={{ fill: 'hsl(var(--secondary))' }}
                            contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '4px', fontSize: '12px' }}
                          />
                          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                            {domainBreakdown.map((_entry, index) => (
                              <Cell key={`cell-${index}`} fill={`hsl(var(--primary))`} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-muted-foreground font-mono">No data available</div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Funding Stages</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[250px] w-full">
                    {fundingLoading ? (
                      <Skeleton className="w-full h-full" />
                    ) : fundingBreakdown && fundingBreakdown.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={fundingBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                          <XAxis dataKey="fundingStage" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                          <RechartsTooltip
                            cursor={{ fill: 'hsl(var(--secondary))' }}
                            contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '4px', fontSize: '12px' }}
                          />
                          <Bar dataKey="count" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-muted-foreground font-mono">No data available</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Recent Activity */}
            <div className="lg:col-span-1">
              <Card className="h-full border-border shadow-sm flex flex-col">
                <CardHeader className="pb-2 shrink-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Recent Activity</CardTitle>
                    <Activity className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto">
                  {activityLoading ? (
                    <div className="space-y-4">
                      {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                    </div>
                  ) : recentActivity && recentActivity.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {recentActivity.map(startup => (
                        <Link key={startup.id} href={`/startups/${startup.id}`}>
                          <div className="p-3 border border-border rounded hover:bg-secondary transition-colors cursor-pointer group">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium font-mono text-sm text-foreground group-hover:text-primary transition-colors truncate">
                                {startup.name}
                              </span>
                              <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-sm ${
                                startup.enrichmentStatus === 'enriched' ? 'bg-primary/20 text-primary' :
                                startup.enrichmentStatus === 'pending' ? 'bg-chart-3/20 text-chart-3' :
                                'bg-muted text-muted-foreground'
                              }`}>
                                {startup.enrichmentStatus || 'unknown'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="truncate max-w-[120px]">{startup.domain || startup.website || 'No domain'}</span>
                              <span className="shrink-0">{new Date(startup.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="h-32 flex items-center justify-center text-sm text-muted-foreground font-mono">No recent activity</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      <Dialog open={isRegistryOpen} onOpenChange={setIsRegistryOpen}>
        <DialogContent className="max-w-[min(96vw,1200px)] h-[86vh] overflow-hidden border-border p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle className="font-mono uppercase tracking-tight">Startup_Registry</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-auto px-6 pb-6">
            <StartupRegistry showHeader={false} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={jobLogModal !== null} onOpenChange={(open) => !open && setJobLogModal(null)}>
        <DialogContent className="max-w-[min(96vw,1100px)] h-[82vh] overflow-hidden border-border p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle className="font-mono uppercase tracking-tight">
              {jobLogModal === "failed" ? "Failed_Enrichment_Logs" : "Successful_Enrichment_Logs"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-auto px-6 pb-6">
            <JobLogTable
              jobs={jobLogModal === "failed" ? allFailedJobs.jobs : allCompletedJobs.jobs}
              total={jobLogModal === "failed" ? allFailedJobs.total : allCompletedJobs.total}
              tone={jobLogModal === "failed" ? "failed" : "success"}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Button
        type="button"
        size="icon"
        onClick={() => setIsChatOpen(true)}
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg shadow-primary/20"
        aria-label="Open chat query"
      >
        <MessageSquare className="h-6 w-6" />
      </Button>

      <Sheet open={isChatOpen} onOpenChange={setIsChatOpen}>
        <SheetContent side="right" className="w-[96vw] sm:max-w-none lg:w-[78vw] xl:w-[70vw] p-0 border-border">
          <SheetHeader className="px-6 pt-6 pb-2">
            <SheetTitle className="font-mono uppercase tracking-tight">Query_Terminal</SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100vh-5.5rem)] px-6 pb-6">
            <ChatPanel showHeader={false} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-8">
      <div className="flex flex-col items-center gap-4 text-center max-w-lg">
        <div className="p-5 rounded-full bg-primary/10 border border-primary/20">
          <Database className="w-10 h-10 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-mono font-bold uppercase tracking-tight text-foreground">No Data Yet</h2>
          <p className="text-muted-foreground font-mono text-sm mt-2 leading-relaxed">
            Your radar is empty. Import a CSV or XLSX file to start tracking and enriching your startup portfolio.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        <div className="flex flex-col items-center gap-2 p-5 border border-border rounded bg-secondary/20 text-center">
          <span className="text-2xl font-mono font-bold text-primary">01</span>
          <UploadCloud className="w-5 h-5 text-muted-foreground" />
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Upload spreadsheet</p>
        </div>
        <div className="flex flex-col items-center gap-2 p-5 border border-border rounded bg-secondary/20 text-center">
          <span className="text-2xl font-mono font-bold text-primary/60">02</span>
          <Zap className="w-5 h-5 text-muted-foreground/60" />
          <p className="text-xs font-mono text-muted-foreground/60 uppercase tracking-wider">Auto-Enrich</p>
        </div>
        <div className="flex flex-col items-center gap-2 p-5 border border-border rounded bg-secondary/20 text-center">
          <span className="text-2xl font-mono font-bold text-primary/40">03</span>
          <Activity className="w-5 h-5 text-muted-foreground/40" />
          <p className="text-xs font-mono text-muted-foreground/40 uppercase tracking-wider">Query & Analyze</p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Link href="/upload">
          <Button size="lg" className="font-mono uppercase tracking-wider gap-2 px-8">
            <UploadCloud className="w-4 h-4" />
            Import CSV or XLSX
            <ArrowRight className="w-4 h-4" />
          </Button>
        </Link>
        <p className="text-xs font-mono text-muted-foreground">
          Required columns: <span className="text-foreground">name</span>, <span className="text-foreground">website</span> — everything else is optional
        </p>
      </div>
    </div>
  );
}

type JobLogListProps = {
  jobs: EnrichmentJob[];
  emptyText: string;
  tone: "success" | "failed";
};

type EnrichmentJob = ReturnType<typeof listEnrichmentJobs>["jobs"][number];

function JobLogList({ jobs, emptyText, tone }: JobLogListProps) {
  if (jobs.length === 0) {
    return (
      <div className="mt-4 border-t border-border/60 pt-3 text-[10px] font-mono uppercase text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-border/60 pt-3 space-y-2">
      {jobs.map((job) => (
        <Link
          key={`${job.startupId}-${job.id}`}
          href={`/startups/${job.startupId}`}
          className="block"
          onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
        >
          <div className="group rounded-sm border border-border/60 bg-secondary/20 px-2 py-1.5 transition-colors hover:bg-secondary/50">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-mono text-foreground group-hover:text-primary">
                {job.startupName || `Startup ${job.startupId}`}
              </span>
              <span className={cn(
                "shrink-0 text-[9px] font-mono uppercase",
                tone === "success" ? "text-primary" : "text-destructive",
              )}>
                {tone === "success" ? "ok" : "fail"}
              </span>
            </div>
            <div className="mt-1 truncate text-[10px] font-mono text-muted-foreground">
              {tone === "failed" && job.errorMessage ? job.errorMessage : new Date(job.createdAt).toLocaleString()}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function JobLogTable({ jobs, total, tone }: { jobs: EnrichmentJob[]; total: number; tone: "success" | "failed" }) {
  const isFailed = tone === "failed";

  return (
    <Card className="border-border rounded-sm bg-card/50">
      <div className="border-b border-border bg-secondary/30 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {isFailed ? (
              <AlertCircle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle className="h-4 w-4 text-primary" />
            )}
            {total.toLocaleString()} {isFailed ? "failed jobs" : "successful jobs"}
          </div>
        </div>
      </div>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground w-[130px]">Status</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Startup</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Job Type</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Message</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground text-right">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center font-mono text-sm text-muted-foreground">
                  {isFailed ? "No failed enrichment jobs found." : "No successful enrichment jobs found."}
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((job) => (
                <TableRow key={`${job.startupId}-${job.id}`} className="border-b border-border/50">
                  <TableCell>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                      isFailed
                        ? "border-destructive/20 bg-destructive/10 text-destructive"
                        : "border-primary/20 bg-primary/10 text-primary",
                    )}>
                      {isFailed ? <AlertCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                      {job.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link href={`/startups/${job.startupId}`} className="font-mono text-sm text-foreground hover:text-primary">
                      {job.startupName || `Startup ${job.startupId}`}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    {job.jobType}
                  </TableCell>
                  <TableCell className="max-w-[360px] font-mono text-xs text-muted-foreground">
                    <span className={cn("block truncate", isFailed && "text-destructive")}>
                      {isFailed ? job.errorMessage || "No error message recorded" : "Enrichment completed"}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function StatCard({
  title,
  value,
  loading,
  icon,
  trend,
  onClick,
  children,
}: {
  title: string;
  value?: number;
  loading: boolean;
  icon: ReactNode;
  trend: string;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const content = (
    <CardContent className="p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{title}</p>
        {icon}
      </div>
      <div className="flex items-end justify-between">
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <h3 className="text-3xl font-mono font-bold tracking-tight text-foreground">{value?.toLocaleString() || 0}</h3>
        )}
      </div>
      <p className="text-[10px] font-mono text-muted-foreground mt-2 uppercase">{trend}</p>
      {children}
    </CardContent>
  );

  return (
    <Card className={cn("border-border shadow-sm", onClick && "transition-colors hover:border-primary/60 hover:bg-secondary/20")}>
      {onClick ? (
        <div
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onClick();
            }
          }}
          className="w-full cursor-pointer text-left"
        >
          {content}
        </div>
      ) : content}
    </Card>
  );
}
