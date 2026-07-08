"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UploadCloud, FileText, CheckCircle, AlertCircle, Loader2, Database } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  importPreview,
  listUploads,
  previewCsvFile,
  type LocalCsvPreview,
  useLocalStoreVersion,
} from "@/lib/local-store";

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LocalCsvPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const { toast } = useToast();
  useLocalStoreVersion();
  const history = listUploads();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.csv')) {
      toast({
        title: "Invalid file type",
        description: "Please select a .csv file",
        variant: "destructive"
      });
      return;
    }
    setFile(selectedFile);
    setPreview(null);
  };

  const handlePreview = async () => {
    if (!file) return;

    setIsPreviewing(true);
    try {
      const data = await previewCsvFile(file);
      setPreview(data);
      if (data.totalRows === 0) {
        toast({
          title: "No rows found",
          description: "The CSV parsed successfully, but no startup rows were detected.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err.message || "Failed to preview CSV",
        variant: "destructive"
      });
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;

    setIsImporting(true);
    try {
      const result = await importPreview(preview);
      toast({
        title: "Import Complete",
        description: `Imported ${result.imported} startups. Skipped ${result.skipped}. Errors: ${result.errors}`,
      });
      setFile(null);
      setPreview(null);
    } catch (err: any) {
      toast({
        title: "Import failed",
        description: err.message || "Failed to import CSV",
        variant: "destructive"
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">
      <div>
        <h1 className="text-3xl font-bold font-mono text-foreground uppercase tracking-tight">Data_Ingestion</h1>
        <p className="text-muted-foreground text-sm font-mono mt-1">Upload CSV rosters for bulk processing and enrichment</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg font-mono uppercase">Upload Source</CardTitle>
            <CardDescription className="font-mono text-xs">Drag and drop a CSV file or click to browse. Expected headers: name, website (optional: pocName, pocEmail, domain, location)</CardDescription>
          </CardHeader>
          <CardContent>
            {!preview ? (
              <div 
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${file ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 bg-secondary/30'}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <div className="flex flex-col items-center gap-4">
                  <div className={`p-4 rounded-full ${file ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    <UploadCloud className="w-8 h-8" />
                  </div>
                  <div>
                    {file ? (
                      <p className="font-mono text-sm text-foreground">{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
                    ) : (
                      <p className="font-mono text-sm text-muted-foreground">Drag and drop CSV here, or <label className="text-primary cursor-pointer hover:underline">browse<input type="file" className="hidden" accept=".csv" onChange={handleFileInput} /></label></p>
                    )}
                  </div>
                  {file && (
                    <Button 
                      onClick={handlePreview} 
                      disabled={isPreviewing}
                      className="font-mono uppercase tracking-wider mt-2"
                    >
                      {isPreviewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                      Process File
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-secondary rounded border border-border">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-primary" />
                    <div>
                      <p className="font-mono text-sm font-bold text-foreground">File parsed successfully</p>
                      <p className="font-mono text-xs text-muted-foreground">{preview.filename} • {preview.totalRows} rows found</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setFile(null); setPreview(null); }} className="font-mono text-xs">
                    Cancel
                  </Button>
                </div>

                <div className="border border-border rounded overflow-hidden">
                  <Table>
                    <TableHeader className="bg-secondary/50">
                      <TableRow>
                        {preview.columns.slice(0, 5).map(col => (
                          <TableHead key={col} className="font-mono text-xs text-muted-foreground uppercase">{col}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.slice(0, 5).map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs max-w-[150px] truncate">{row.name}</TableCell>
                          <TableCell className="font-mono text-xs text-primary max-w-[150px] truncate">{row.website || '-'}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground max-w-[150px] truncate">{row.pocName || '-'}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground max-w-[150px] truncate">{row.domain || '-'}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground max-w-[150px] truncate">{row.fundingStage || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {preview.totalRows > 5 && (
                    <div className="p-2 text-center border-t border-border bg-muted/20">
                      <p className="font-mono text-xs text-muted-foreground">+ {preview.totalRows - 5} more rows</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
          {preview && (
            <CardFooter className="flex justify-end border-t border-border bg-card p-4">
              <Button 
                onClick={handleConfirm} 
                disabled={isImporting}
                className="font-mono uppercase tracking-wider"
              >
                {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                Import {preview.totalRows} Startups
              </Button>
            </CardFooter>
          )}
        </Card>

        {/* Upload History */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg font-mono uppercase">Upload Log</CardTitle>
          </CardHeader>
          <CardContent>
            {history && history.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-xs uppercase">Filename</TableHead>
                    <TableHead className="font-mono text-xs uppercase text-right">Rows</TableHead>
                    <TableHead className="font-mono text-xs uppercase">Status</TableHead>
                    <TableHead className="font-mono text-xs uppercase text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map(file => (
                    <TableRow key={file.id}>
                      <TableCell className="font-mono text-sm">{file.filename}</TableCell>
                      <TableCell className="font-mono text-sm text-right">{file.rowCount}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${
                          file.status === 'completed' ? 'bg-primary/20 text-primary' : 
                          file.status === 'failed' ? 'bg-destructive/20 text-destructive' : 
                          'bg-muted text-muted-foreground'
                        }`}>
                          {file.status}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground text-right">
                        {new Date(file.uploadedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-8 text-center border border-dashed border-border rounded">
                <p className="text-sm font-mono text-muted-foreground">No upload history</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
