export type SpreadsheetFormat = "csv" | "xlsx";

export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;
export const MAX_SPREADSHEET_ROWS = 50_001; // Header plus 50,000 data rows.
export const MAX_SPREADSHEET_COLUMNS = 100;
export const SPREADSHEET_ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type NormalizedSpreadsheet = {
  csvText: string;
  format: SpreadsheetFormat;
  originalFilename: string;
  normalizedFilename: string;
};

export function spreadsheetFormat(filename: string): SpreadsheetFormat | null {
  const extension = filename.trim().toLowerCase().match(/\.([^.]+)$/)?.[1];
  return extension === "csv" || extension === "xlsx" ? extension : null;
}

export function isSupportedSpreadsheetFile(file: Pick<File, "name" | "size">) {
  return spreadsheetFormat(file.name) !== null && file.size > 0 && file.size <= MAX_SPREADSHEET_BYTES;
}

export async function spreadsheetFileToCsv(file: File): Promise<NormalizedSpreadsheet> {
  const format = spreadsheetFormat(file.name);
  if (!format) throw new Error("Only .csv and .xlsx files are supported.");
  if (file.size === 0) throw new Error("The selected file is empty.");
  if (file.size > MAX_SPREADSHEET_BYTES) throw new Error("The selected file exceeds the 10 MB upload limit.");

  if (format === "csv") {
    return {
      csvText: stripBom(await file.text()),
      format,
      originalFilename: file.name,
      normalizedFilename: file.name,
    };
  }

  const { readSheet } = await import("read-excel-file/browser");
  const rows = await readSheet(file);
  validateDimensions(rows);
  return {
    csvText: rowsToCsv(rows),
    format,
    originalFilename: file.name,
    normalizedFilename: replaceExtension(file.name, ".csv"),
  };
}

export function rowsToCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map((cell) => escapeCsvCell(cellToString(cell))).join(",")).join("\r\n");
}

function validateDimensions(rows: unknown[][]) {
  if (rows.length === 0 || rows.every((row) => row.every((cell) => cell == null || cell === ""))) {
    throw new Error("The first worksheet is empty.");
  }
  if (rows.length > MAX_SPREADSHEET_ROWS) throw new Error("The spreadsheet exceeds the 50,000-row import limit.");
  if (rows.some((row) => row.length > MAX_SPREADSHEET_COLUMNS)) throw new Error("The spreadsheet exceeds the 100-column import limit.");
}

function cellToString(value: unknown): string {
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
