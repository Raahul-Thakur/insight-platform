"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import Link from "next/link";
import { useDebounce } from "@/hooks/use-debounce";
import { listStartups, useLocalStoreVersion, type EnrichmentStatus } from "@/lib/local-store";

type StartupRegistryProps = {
  showHeader?: boolean;
  className?: string;
};

export function StartupRegistry({ showHeader = true, className = "" }: StartupRegistryProps) {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>("all");

  const debouncedKeyword = useDebounce(keyword, 500);
  useLocalStoreVersion();

  const data = listStartups({
    page,
    limit: 20,
    keyword: debouncedKeyword || undefined,
    enrichmentStatus: status !== "all" ? status as EnrichmentStatus : undefined,
  });
  const isLoading = false;

  const handleNextPage = () => setPage(p => p + 1);
  const handlePrevPage = () => setPage(p => Math.max(1, p - 1));

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const rangeStart = data && data.total > 0 ? (page - 1) * data.limit + 1 : 0;

  return (
    <div className={`flex flex-col gap-6 max-w-full mx-auto ${className}`}>
      {showHeader && (
        <div>
          <h1 className="text-3xl font-bold font-mono text-foreground uppercase tracking-tight">Startup_Registry</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">Master list of tracked entities</p>
        </div>
      )}

      <Card className="border-border rounded-sm">
        <div className="p-4 border-b border-border bg-secondary/30 flex flex-col sm:flex-row gap-4 justify-between items-center">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
              placeholder="Search companies, domains, or keywords..."
              className="pl-9 font-mono text-sm bg-card border-border rounded-sm h-10"
            />
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2 text-muted-foreground font-mono text-xs uppercase tracking-wider shrink-0">
              <Filter className="w-4 h-4" /> Status:
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[140px] font-mono text-sm h-10 rounded-sm">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="enriched">Enriched</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="missing">Missing Data</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider w-[250px]">Company</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Domain</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Location</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Stage</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Funding</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-wider w-[120px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20 rounded" /></TableCell>
                    </TableRow>
                  ))
                ) : data?.startups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center font-mono text-sm text-muted-foreground">
                      No startups match your criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.startups.map((startup) => (
                    <TableRow key={startup.id} className="group cursor-pointer">
                      <TableCell>
                        <Link href={`/startups/${startup.id}`} className="block">
                          <div className="font-mono font-medium text-sm text-foreground group-hover:text-primary transition-colors">
                            {startup.name}
                          </div>
                          {startup.website && (
                            <div className="text-xs text-muted-foreground font-mono truncate max-w-[230px]">
                              {startup.website.replace(/^https?:\/\/(www\.)?/, '')}
                            </div>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        <Link href={`/startups/${startup.id}`} className="block">{startup.domain || '-'}</Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        <Link href={`/startups/${startup.id}`} className="block">{startup.hqLocation || startup.country || '-'}</Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        <Link href={`/startups/${startup.id}`} className="block">{startup.fundingStage || '-'}</Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        <Link href={`/startups/${startup.id}`} className="block">{startup.totalFunding || '-'}</Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/startups/${startup.id}`} className="block">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-mono uppercase tracking-wider ${
                            startup.enrichmentStatus === 'enriched' ? 'bg-primary/20 text-primary border border-primary/20' :
                            startup.enrichmentStatus === 'pending' ? 'bg-chart-3/20 text-chart-3 border border-chart-3/20' :
                            'bg-muted text-muted-foreground border border-border'
                          }`}>
                            {startup.enrichmentStatus || 'unknown'}
                          </span>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        <div className="p-4 border-t border-border flex items-center justify-between bg-card">
          <div className="text-xs font-mono text-muted-foreground">
            {data && `Showing ${rangeStart} to ${Math.min(page * data.limit, data.total)} of ${data.total}`}
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
