"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Globe, MapPin, Users, DollarSign, Activity, Database, CheckCircle, Clock, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { enrichStartupWithOpenAI, getStartup, useLocalStoreVersion } from "@/lib/local-store";

export default function StartupDetail() {
  const params = useParams();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = parseInt(rawId || "0", 10);
  const { toast } = useToast();
  const [isEnriching, setIsEnriching] = useState(false);
  useLocalStoreVersion();
  const startup = getStartup(id);
  const isLoading = false;

  const handleEnrich = async () => {
    setIsEnriching(true);
    try {
      await enrichStartupWithOpenAI(id);
      toast({ title: "OpenAI Enrichment Complete", description: "Web research fields were saved locally." });
    } catch (error) {
      toast({
        title: "OpenAI enrichment failed",
        description: error instanceof Error ? error.message : "Check that the API server is running.",
        variant: "destructive",
      });
    } finally {
      setIsEnriching(false);
    }
  };

  if (isLoading) {
    return <div className="space-y-6 max-w-6xl mx-auto"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!startup) {
    return <div className="p-8 text-center font-mono">Startup not found</div>;
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto w-full pb-12">
      <div className="flex items-center gap-4 text-sm font-mono text-muted-foreground">
        <Link href="/startups" className="hover:text-primary transition-colors flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Registry
        </Link>
        <span>/</span>
        <span className="text-foreground">{startup.name}</span>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-4xl font-bold font-mono text-foreground uppercase tracking-tight">{startup.name}</h1>
            <span className={`px-2 py-1 rounded-sm text-xs font-mono uppercase tracking-wider ${
              startup.enrichmentStatus === 'enriched' ? 'bg-primary/20 text-primary border border-primary/20' :
              startup.enrichmentStatus === 'pending' ? 'bg-chart-3/20 text-chart-3 border border-chart-3/20' :
              'bg-muted text-muted-foreground border border-border'
            }`}>
              {startup.enrichmentStatus || 'unknown'}
            </span>
          </div>
          {startup.website && (
            <a href={startup.website.startsWith('http') ? startup.website : `https://${startup.website}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono text-sm flex items-center gap-1">
              <Globe className="w-3 h-3" /> {startup.website.replace(/^https?:\/\/(www\.)?/, '')}
              <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          <div className="text-right mr-4">
            <div className="text-xs font-mono text-muted-foreground uppercase">Confidence Score</div>
            <div className="text-xl font-mono text-primary font-bold">{startup.confidenceScore ? `${startup.confidenceScore}%` : '--'}</div>
          </div>
          <Button 
            onClick={handleEnrich} 
            disabled={isEnriching || startup.enrichmentStatus === 'pending'}
            className="font-mono uppercase tracking-wider rounded-sm"
          >
            {isEnriching ? <Activity className="w-4 h-4 mr-2 animate-pulse" /> : <Database className="w-4 h-4 mr-2" />}
            Run OpenAI Enrichment
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
        {/* Main Details */}
        <div className="md:col-span-2 space-y-6">
          <Card className="border-border rounded-sm bg-card/50">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Entity Profile</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                <DetailItem label="Domain" value={startup.domain} />
                <DetailItem label="Location" value={startup.hqLocation || startup.country} icon={<MapPin className="w-4 h-4 text-muted-foreground" />} />
                <DetailItem label="Funding Stage" value={startup.fundingStage} icon={<DollarSign className="w-4 h-4 text-muted-foreground" />} />
                <DetailItem label="Total Funding" value={startup.totalFunding} />
                <DetailItem label="Employees" value={startup.employeeCount?.toString()} icon={<Users className="w-4 h-4 text-muted-foreground" />} />
                <DetailItem label="Point of Contact" value={startup.pocName ? `${startup.pocName} (${startup.pocEmail || 'No email'})` : null} />
              </div>

              <div className="mt-8 pt-6 border-t border-border/50">
                <div className="text-xs font-mono uppercase text-muted-foreground mb-3 tracking-wider">Description</div>
                <p className="text-sm text-foreground/90 leading-relaxed font-sans">
                  {startup.description || startup.websiteSummary || <span className="text-muted-foreground italic">No description available. Run enrichment to generate.</span>}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Sources Table */}
          <Card className="border-border rounded-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Data Sources</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {startup.sources && startup.sources.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm font-mono">
                    <thead className="bg-muted/30 border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground uppercase text-xs">Field</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground uppercase text-xs">Value</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground uppercase text-xs">Source</th>
                        <th className="px-4 py-3 text-right font-medium text-muted-foreground uppercase text-xs">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {startup.sources.map(source => (
                        <tr key={source.id} className="hover:bg-secondary/20">
                          <td className="px-4 py-3 text-foreground">{source.extractedField}</td>
                          <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]" title={source.extractedValue || ''}>{source.extractedValue || '-'}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex px-2 py-0.5 rounded-sm bg-secondary text-[10px] uppercase text-muted-foreground border border-border">
                              {source.sourceType}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-xs ${source.confidenceScore && source.confidenceScore > 80 ? 'text-primary' : source.confidenceScore && source.confidenceScore > 50 ? 'text-chart-3' : 'text-destructive'}`}>
                              {source.confidenceScore ? `${source.confidenceScore}%` : '-'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-sm font-mono text-muted-foreground">
                  No source traces available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="border-border rounded-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">External Links</CardTitle>
            </CardHeader>
            <CardContent className="p-4 flex flex-col gap-2">
              <LinkButton href={startup.website} label="Website" />
              <LinkButton href={startup.linkedinUrl} label="LinkedIn" />
              <LinkButton href={startup.crunchbaseUrl} label="Crunchbase" />
              <LinkButton href={startup.tracxnUrl} label="Tracxn" />
            </CardContent>
          </Card>

          <Card className="border-border rounded-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Enrichment History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="p-4 border-b border-border/50 text-xs font-mono text-muted-foreground flex justify-between">
                <span>Last Run</span>
                <span>{startup.lastEnrichedAt ? new Date(startup.lastEnrichedAt).toLocaleDateString() : 'Never'}</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {startup.enrichmentJobs && startup.enrichmentJobs.length > 0 ? (
                  <div className="flex flex-col">
                    {startup.enrichmentJobs.map(job => (
                      <div key={job.id} className="p-4 border-b border-border/50 hover:bg-secondary/10 last:border-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-xs text-foreground uppercase">{job.jobType}</span>
                          <span className={`text-[10px] font-mono uppercase ${
                            job.status === 'completed' ? 'text-primary' : 
                            job.status === 'failed' ? 'text-destructive' : 
                            'text-chart-3 animate-pulse'
                          }`}>
                            {job.status}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {new Date(job.createdAt).toLocaleString()}
                        </div>
                        {job.errorMessage && (
                          <div className="mt-2 text-xs font-mono text-destructive bg-destructive/10 p-2 rounded-sm border border-destructive/20 break-words">
                            {job.errorMessage}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs font-mono text-muted-foreground">No history</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value, icon }: { label: string, value: string | null | undefined, icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-mono uppercase text-muted-foreground mb-1 tracking-wider">{label}</div>
      <div className="font-mono text-sm text-foreground flex items-center gap-2">
        {icon}
        {value || <span className="text-muted-foreground/50">--</span>}
      </div>
    </div>
  );
}

function LinkButton({ href, label }: { href: string | null | undefined, label: string }) {
  if (!href) return (
    <div className="flex items-center justify-between p-2 rounded-sm border border-border/30 bg-muted/20 text-muted-foreground/50 cursor-not-allowed">
      <span className="font-mono text-xs">{label}</span>
      <span className="text-[10px] font-mono">N/A</span>
    </div>
  );
  
  const formattedHref = href.startsWith('http') ? href : `https://${href}`;
  
  return (
    <a href={formattedHref} target="_blank" rel="noreferrer" className="flex items-center justify-between p-2 rounded-sm border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors group">
      <span className="font-mono text-xs text-foreground group-hover:text-primary transition-colors">{label}</span>
      <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
    </a>
  );
}
