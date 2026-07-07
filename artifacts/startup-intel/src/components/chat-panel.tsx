"use client";

import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageSquare, Send, Terminal, Zap, Clock, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import {
  listChatHistory,
  queryStartupsWithModel,
  useLocalStoreVersion,
  type LocalChatResponse,
} from "@/lib/local-store";

type ChatPanelProps = {
  showHeader?: boolean;
  className?: string;
};

export function ChatPanel({ showHeader = true, className = "" }: ChatPanelProps) {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [response, setResponse] = useState<LocalChatResponse | null>(null);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  useLocalStoreVersion();
  const history = listChatHistory();
  const historyLoading = false;
  const inputRef = useRef<HTMLInputElement>(null);

  const executeQuery = async (q: string) => {
    setActiveQuery(q);
    setIsPending(true);
    try {
      setResponse(await queryStartupsWithModel(q));
    } catch (error) {
      toast({
        title: "Chat model query failed",
        description: error instanceof Error ? error.message : "Check the API server and chat model key.",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    await executeQuery(trimmed);
  };

  const handleHistoryClick = async (q: string) => {
    setQuery(q);
    await executeQuery(q);
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className={`flex flex-col h-full w-full gap-6 ${className}`}>
      {showHeader && (
        <div>
          <h1 className="text-3xl font-bold font-mono text-foreground uppercase tracking-tight">Query_Terminal</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">Natural language extraction over registry data</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
        <div className="lg:col-span-3 flex flex-col gap-4 h-full min-h-0">
          <Card className="border-primary/50 shadow-[0_0_15px_rgba(0,0,0,0.1)] shrink-0 overflow-visible">
            <div className="p-1 bg-gradient-to-r from-primary/20 via-transparent to-transparent rounded-t-sm" />
            <CardContent className="p-4">
              <form onSubmit={handleSubmit} className="relative">
                <Terminal className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary" />
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="e.g. Find Seed stage fintech companies in Hyderabad..."
                  className="pl-12 pr-24 h-14 bg-card border-border font-mono text-base focus-visible:ring-primary focus-visible:border-primary rounded-sm shadow-inner"
                />
                <Button
                  type="submit"
                  disabled={isPending || !query.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-4 font-mono uppercase tracking-wider rounded-sm"
                >
                  {isPending ? <div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" /> : <><Send className="w-4 h-4 mr-2" /> Exec</>}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-border flex-1 flex flex-col min-h-0 overflow-hidden bg-card/50">
            {isPending ? (
              <div className="flex-1 flex flex-col items-center justify-center text-primary font-mono gap-4">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <div className="animate-pulse tracking-widest text-sm uppercase">Parsing Query Structure...</div>
              </div>
            ) : response ? (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="p-4 border-b border-border bg-secondary/30 shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Search className="w-4 h-4 text-muted-foreground" />
                      <span className="font-mono text-sm text-foreground">Matched {response.totalMatched} entities</span>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono">
                      {response.cacheHit && (
                        <span className="flex items-center gap-1 text-chart-2 bg-chart-2/10 px-2 py-1 rounded-sm border border-chart-2/20">
                          <Zap className="w-3 h-3" /> Cache Hit
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="w-3 h-3" /> {response.processingMs}ms
                      </span>
                      {response.model && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          {response.provider}: {response.model}
                        </span>
                      )}
                    </div>
                  </div>
                  {response.answer && (
                    <div className="mt-3 rounded-sm border border-border bg-card px-3 py-2 font-mono text-xs text-foreground">
                      {response.answer}
                    </div>
                  )}

                  {response.parsedFilters && Object.keys(response.parsedFilters).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(response.parsedFilters).map(([k, v]) => {
                        if (v === null || v === undefined) return null;
                        return (
                          <div key={k} className="flex items-center text-[10px] font-mono border border-border rounded-sm overflow-hidden">
                            <span className="bg-muted px-2 py-1 uppercase text-muted-foreground border-r border-border">{k}</span>
                            <span className="bg-card px-2 py-1 text-primary">{String(v)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-auto">
                  {response.startups.length > 0 ? (
                    <Table>
                      <TableHeader className="sticky top-0 bg-card border-b border-border shadow-sm z-10">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="font-mono text-xs uppercase text-muted-foreground w-[200px]">Entity</TableHead>
                          <TableHead className="font-mono text-xs uppercase text-muted-foreground">Domain</TableHead>
                          <TableHead className="font-mono text-xs uppercase text-muted-foreground">Location</TableHead>
                          <TableHead className="font-mono text-xs uppercase text-muted-foreground">Stage</TableHead>
                          <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right w-[100px]">Conf</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {response.startups.map((startup) => (
                          <TableRow key={startup.id} className="group border-b border-border/50">
                            <TableCell>
                              <Link href={`/startups/${startup.id}`} className="font-mono text-sm text-foreground hover:text-primary transition-colors block">
                                {startup.name}
                              </Link>
                              <div className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate max-w-[180px]">
                                {startup.pocName || 'No POC'}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {startup.domain || '-'}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {startup.hqLocation || startup.country || '-'}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-primary">
                              {startup.fundingStage || '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={`font-mono text-xs ${
                                startup.confidenceScore && startup.confidenceScore > 80 ? 'text-primary' :
                                startup.confidenceScore && startup.confidenceScore > 50 ? 'text-chart-3' :
                                'text-muted-foreground'
                              }`}>
                                {startup.confidenceScore ? `${startup.confidenceScore}%` : '-'}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center p-8">
                      <MessageSquare className="w-12 h-12 text-muted mb-4" />
                      <p className="font-mono text-foreground">Zero matches found in registry.</p>
                      <p className="font-mono text-sm text-muted-foreground mt-2">Adjust query parameters and re-execute.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-50">
                <Terminal className="w-16 h-16 text-muted-foreground mb-4" />
                <p className="font-mono text-muted-foreground uppercase tracking-widest text-sm">System Ready</p>
                <p className="font-mono text-xs text-muted-foreground mt-2">Awaiting query input...</p>
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-1 h-full min-h-0">
          <Card className="border-border h-full flex flex-col">
            <CardHeader className="pb-3 border-b border-border/50 shrink-0">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Command History</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-y-auto">
              {historyLoading ? (
                <div className="p-4 space-y-4">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : history && history.length > 0 ? (
                <div className="flex flex-col divide-y divide-border/30">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleHistoryClick(item.queryText)}
                      className={`text-left p-3 font-mono text-xs transition-colors hover:bg-secondary/50 group ${activeQuery === item.queryText ? 'bg-primary/5 border-l-2 border-primary' : 'border-l-2 border-transparent'}`}
                    >
                      <div className="text-foreground line-clamp-2 leading-relaxed mb-1 group-hover:text-primary transition-colors">
                        {item.queryText}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{new Date(item.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        {item.resultCount !== undefined && <span>{item.resultCount} results</span>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center font-mono text-xs text-muted-foreground">
                  No history recorded
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
