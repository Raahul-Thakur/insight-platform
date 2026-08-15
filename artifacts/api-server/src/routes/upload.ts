import fs from "fs";
import path from "path";
import { Router, type IRouter } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import {
  ConfirmUploadBody,
  ConfirmUploadResponse,
  ListUploadedFilesResponse,
  UploadCsvResponse,
} from "@workspace/api-zod";
import {
  createEnrichmentJob,
  createStartup,
  createUploadedFile,
  findStartupByIdentity,
  listUploadedFiles,
  normalizeName,
  updateUploadedFile,
} from "../lib/appStore";
import { logger } from "../lib/logger";

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

const uploadsDir = path.resolve(workspaceRoot, "artifacts/api-server/uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension === ".csv" || extension === ".xlsx") {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and XLSX files are allowed"));
    }
  },
});

const router: IRouter = Router();

const COLUMN_MAP: Record<string, string> = {
  "company name": "name",
  "startup name": "name",
  name: "name",
  website: "website",
  url: "website",
  "company website": "website",
  "poc name": "pocName",
  "point of contact": "pocName",
  contact: "pocName",
  "poc email": "pocEmail",
  email: "pocEmail",
  "contact email": "pocEmail",
  domain: "domain",
  industry: "domain",
  sector: "domain",
  "funding stage": "fundingStage",
  stage: "fundingStage",
  "funding round": "fundingStage",
  location: "location",
  city: "location",
  "hq location": "location",
  "hq city": "location",
  founders: "founders",
  founder: "founders",
  "founder names": "founders",
  investors: "investors",
  investor: "investors",
  "linkedin url": "linkedinUrl",
  linkedin: "linkedinUrl",
  "crunchbase url": "crunchbaseUrl",
  crunchbase: "crunchbaseUrl",
  "tracxn url": "tracxnUrl",
  tracxn: "tracxnUrl",
};

const parsedPreviews = new Map<
  string,
  { rows: Record<string, string | null>[]; filename: string; originalFilename: string; filepath: string; mapping: Record<string, string> }
>();

router.post("/upload/csv", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  let filepath = req.file.path;
  const originalFilename = req.file.originalname;
  const isXlsx = path.extname(originalFilename).toLowerCase() === ".xlsx";
  const normalizedFilename = isXlsx ? replaceExtension(originalFilename, ".csv") : originalFilename;

  let records: Record<string, string>[];
  try {
    let csvText: string;
    if (isXlsx) {
      const rows = await readSheet(filepath);
      validateSpreadsheetDimensions(rows);
      csvText = rowsToCsv(rows);
      const convertedPath = replaceExtension(filepath, ".csv");
      fs.writeFileSync(convertedPath, csvText, "utf-8");
      fs.unlinkSync(filepath);
      filepath = convertedPath;
    } else {
      csvText = stripBom(fs.readFileSync(filepath, "utf-8"));
    }
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (error) {
    removeFile(filepath);
    if (isXlsx) removeFile(replaceExtension(req.file.path, ".csv"));
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to parse spreadsheet" });
    return;
  }

  if (records.length === 0) {
    removeFile(filepath);
    res.status(400).json({ error: "The spreadsheet contains no data rows" });
    return;
  }

  const columns = Object.keys(records[0]!);
  const columnMapping = mapColumns(columns);
  const rows = records.slice(0, 10).map((record) => mapPreviewRow(record, columns, columnMapping));
  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  parsedPreviews.set(fileId, {
    rows: records as Record<string, string | null>[],
    filename: normalizedFilename,
    originalFilename,
    filepath,
    mapping: columnMapping,
  });

  req.log.info({ fileId, rowCount: records.length, originalFilename, normalizedFilename, convertedFromXlsx: isXlsx }, "Spreadsheet parsed and normalized to CSV");

  res.json(
    UploadCsvResponse.parse({
      fileId,
      filename: originalFilename,
      rows,
      totalRows: records.length,
      columns,
      mappedColumns: columnMapping,
    }),
  );
});

router.post("/upload/confirm", async (req, res): Promise<void> => {
  const parsed = ConfirmUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const preview = parsedPreviews.get(parsed.data.fileId);
  if (!preview) {
    res.status(400).json({ error: "Invalid or expired file ID. Please upload again." });
    return;
  }

  parsedPreviews.delete(parsed.data.fileId);

  const columns = Object.keys(preview.rows[0] ?? {});
  const uploadRecord = createUploadedFile({
    filename: `${Date.now()}-${preview.filename}`,
    originalFilename: preview.originalFilename,
    rowCount: preview.rows.length,
    status: "importing",
  });

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of preview.rows) {
    try {
      const row = mapPreviewRow(record as Record<string, string>, columns, preview.mapping);
      if (!row.name.trim()) {
        skipped += 1;
        continue;
      }

      const normalizedName = normalizeName(row.name);
      if (findStartupByIdentity({ name: row.name, website: row.website })) {
        skipped += 1;
        continue;
      }

      const startup = createStartup({
        name: row.name.trim(),
        normalizedName,
        website: row.website?.trim() || "https://unknown.com",
        pocName: row.pocName?.trim() || null,
        pocEmail: row.pocEmail?.trim() || null,
        domain: row.domain?.trim() || null,
        fundingStage: row.fundingStage?.trim() || null,
        hqLocation: row.location?.trim() || null,
        founders: splitList(row.founders),
        investors: splitList(row.investors),
        linkedinUrl: row.linkedinUrl?.trim() || null,
        crunchbaseUrl: row.crunchbaseUrl?.trim() || null,
        tracxnUrl: row.tracxnUrl?.trim() || null,
      });

      if (!startup.domain || !startup.hqLocation || !startup.fundingStage) {
        createEnrichmentJob(startup.id, "website_crawl");
      }

      imported += 1;
    } catch (err) {
      logger.error({ err }, "Error importing row");
      errors += 1;
    }
  }

  updateUploadedFile(uploadRecord.id, {
    importedCount: imported,
    status: errors > 0 && imported === 0 ? "failed" : "imported",
  });

  try {
    fs.unlinkSync(preview.filepath);
  } catch {
    // Temp-file cleanup is best effort.
  }

  req.log.info({ imported, skipped, errors, filename: preview.filename }, "Spreadsheet import complete");

  res.json(
    ConfirmUploadResponse.parse({
      imported,
      skipped,
      errors,
      message: `Successfully imported ${imported} startups. ${skipped} duplicates skipped. ${errors} errors.`,
    }),
  );
});

router.get("/uploaded-files", async (_req, res): Promise<void> => {
  res.json(ListUploadedFilesResponse.parse(listUploadedFiles()));
});

function mapColumns(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const normalized = header.trim().toLowerCase();
    if (COLUMN_MAP[normalized]) {
      mapping[header] = COLUMN_MAP[normalized]!;
    }
  }
  return mapping;
}

function mapPreviewRow(
  record: Record<string, string | null>,
  columns: string[],
  columnMapping: Record<string, string>,
) {
  const fieldValue = (field: string) => {
    const column = Object.keys(columnMapping).find((key) => columnMapping[key] === field);
    return column ? record[column] ?? null : null;
  };

  return {
    name: fieldValue("name") ?? record[columns[0]!] ?? "Unknown",
    website: fieldValue("website"),
    pocName: fieldValue("pocName"),
    pocEmail: fieldValue("pocEmail"),
    domain: fieldValue("domain"),
    fundingStage: fieldValue("fundingStage"),
    location: fieldValue("location"),
    founders: fieldValue("founders"),
    investors: fieldValue("investors"),
    linkedinUrl: fieldValue("linkedinUrl"),
    crunchbaseUrl: fieldValue("crunchbaseUrl"),
    tracxnUrl: fieldValue("tracxnUrl"),
  };
}

function splitList(value: string | null | undefined) {
  if (!value) return [];
  return value
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateSpreadsheetDimensions(rows: unknown[][]) {
  if (rows.length === 0 || rows.every((row) => row.every((cell) => cell == null || cell === ""))) {
    throw new Error("The first worksheet is empty");
  }
  if (rows.length > 50_001) throw new Error("The spreadsheet exceeds the 50,000-row import limit");
  if (rows.some((row) => row.length > 100)) throw new Error("The spreadsheet exceeds the 100-column import limit");
}

function rowsToCsv(rows: unknown[][]) {
  return rows.map((row) => row.map((cell) => escapeCsvCell(cellToString(cell))).join(",")).join("\r\n");
}

function cellToString(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  return String(value);
}

function escapeCsvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function replaceExtension(filename: string, extension: string) {
  return filename.replace(/\.[^.]+$/, "") + extension;
}

function stripBom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function removeFile(filepath: string) {
  try { fs.unlinkSync(filepath); } catch { /* best-effort cleanup */ }
}

export default router;
