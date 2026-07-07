import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Filter, RefreshCw, AlertCircle, CheckCircle, Clock, PlayCircle } from "lucide-react";
import { Link } from "wouter";
import { listEnrichmentJobs, useLocalStoreVersion } from "@/lib/local-store";

export default function Enrichment() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [isRefetching, setIsRefetching] = useState(false);
  useLocalStoreVersion();
  const data = listEnrichmentJobs({
    page,
    limit: 20,
    status: status !== "all" ? status : undefined,
  });
  const isLoading = false;

  const refetch = () => {
    setIsRefetching(true);
    window.setTimeout(() => setIsRefetching(false), 150);
  };

  const handleNextPage = () => setPage(p => p + 1);
  const handlePrevPage = () => setPage(p => Math.max(1, p - 1));

  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  const getStatusIcon = (jobStatus: string) => {
    switch (jobStatus) {
      case 'completed': return <CheckCircle className="w-3 h-3 text-primary" />;
      case 'failed': return <AlertCircle className="w-3 h-3 text-destructive" />;
      case 'running': return <PlayCircle className="w-3 h-3 text-chart-2 animate-pulse" />;
      case 'pending': return <Clock className="w-3 h-3 text-muted-foreground" />;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">
      <div>
        <h1 className="text-3xl font-bold font-mono text-foreground uppercase tracking-tight">Job_Queue</h1>
        <p className="text-muted-foreground text-sm font-mono mt-1">Background worker status and enrichment logs</p>
      </div>

      <Card className="border-border rounded-sm bg-card/50">
        <div className="p-4 border-b border-border bg-secondary/30 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-muted-foreground font-mono text-xs uppercase tracking-wider shrink-0">
              <Filter className="w-4 h-4" /> Filter Status:
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[160px] font-mono text-sm h-9 rounded-sm border-border bg-card">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Jobs</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()} 
            disabled={isRefetching || isLoading}
            className="font-mono text-xs uppercase tracking-wider h-9 border-border"
          >
            <RefreshCw className={`w-3 h-3 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider w-[120px]">Status</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Type</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Target Entity</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider text-right">Created</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider text-right">Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24 rounded" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : data?.jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center font-mono text-sm text-muted-foreground">
                    No jobs found in queue.
                  </TableCell>
                </TableRow>
              ) : (
                data?.jobs.map((job) => (
                  <TableRow key={job.id} className="border-b border-border/50">
                    <TableCell>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-mono uppercase tracking-wider border ${
                        job.status === 'completed' ? 'bg-primary/10 text-primary border-primary/20' :
                        job.status === 'failed' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                        job.status === 'running' ? 'bg-chart-2/10 text-chart-2 border-chart-2/20' :
                        'bg-muted text-muted-foreground border-border'
                      }`}>
                        {getStatusIcon(job.status)}
                        {job.status}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground uppercase tracking-wider">
                      {job.jobType}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <Link href={`/startups/${job.startupId}`} className="font-mono text-sm text-foreground hover:text-primary transition-colors">
                          {job.startupName || `ID: ${job.startupId}`}
                        </Link>
                        {job.errorMessage && (
                          <span className="text-[10px] font-mono text-destructive max-w-md truncate mt-1">
                            ERR: {job.errorMessage}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground text-right">
                      {new Date(job.createdAt).toLocaleString(undefined, { 
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' 
                      })}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground text-right">
                      {job.completedAt ? new Date(job.completedAt).toLocaleTimeString(undefined, {
                        hour: '2-digit', minute: '2-digit', second: '2-digit'
                      }) : '--'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        <div className="p-4 border-t border-border flex items-center justify-between bg-card">
          <div className="text-xs font-mono text-muted-foreground">
            {data && `Showing ${(page - 1) * data.limit + 1} to ${Math.min(page * data.limit, data.total)} of ${data.total}`}
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handlePrevPage} 
              disabled={page === 1 || isLoading}
              className="font-mono text-xs rounded-sm border-border h-8"
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
            </Button>
            <div className="text-xs font-mono px-3">Page {page} / {totalPages}</div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleNextPage} 
              disabled={page === totalPages || isLoading || !data}
              className="font-mono text-xs rounded-sm border-border h-8"
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
