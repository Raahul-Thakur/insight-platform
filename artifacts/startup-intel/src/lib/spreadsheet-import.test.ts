import assert from "node:assert/strict";
import test from "node:test";
import { File } from "node:buffer";
import { strToU8, zipSync } from "fflate";
import { previewSpreadsheetFile } from "./local-store";
import {
  rowsToCsv,
  spreadsheetFileToCsv,
  spreadsheetFormat,
} from "./spreadsheet-import";

test("recognizes only CSV and modern Excel workbooks", () => {
  assert.equal(spreadsheetFormat("startups.CSV"), "csv");
  assert.equal(spreadsheetFormat("startups.xlsx"), "xlsx");
  assert.equal(spreadsheetFormat("startups.xls"), null);
});

test("keeps CSV uploads as CSV and removes a UTF-8 BOM", async () => {
  const file = new File(["\uFEFFname,website\r\nAcme,https://acme.test"], "startups.csv", { type: "text/csv" });
  const normalized = await spreadsheetFileToCsv(file as unknown as globalThis.File);

  assert.equal(normalized.format, "csv");
  assert.equal(normalized.normalizedFilename, "startups.csv");
  assert.equal(normalized.csvText, "name,website\r\nAcme,https://acme.test");
});

test("converts the first XLSX worksheet to escaped CSV", async () => {
  const file = new File([makeWorkbook()], "startups.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const normalized = await spreadsheetFileToCsv(file as unknown as globalThis.File);

  assert.equal(normalized.format, "xlsx");
  assert.equal(normalized.originalFilename, "startups.xlsx");
  assert.equal(normalized.normalizedFilename, "startups.csv");
  assert.equal(
    normalized.csvText,
    'name,website,pocName\r\nAcme,https://acme.test,"Ada, ""CEO"""',
  );
});

test("feeds a converted XLSX workbook into the existing startup preview pipeline", async () => {
  const file = new File([makeWorkbook()], "startups.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const preview = await previewSpreadsheetFile(file as unknown as globalThis.File);

  assert.equal(preview.sourceFormat, "xlsx");
  assert.equal(preview.normalizedFilename, "startups.csv");
  assert.equal(preview.totalRows, 1);
  assert.equal(preview.rows[0]?.name, "Acme");
  assert.equal(preview.rows[0]?.website, "https://acme.test");
  assert.equal(preview.rows[0]?.pocName, 'Ada, "CEO"');
});

test("serializes commas, quotes, line breaks, booleans, and null values", () => {
  assert.equal(rowsToCsv([["A,B", 'C"D', "line\nbreak", true, null]]), '"A,B","C""D","line\nbreak",true,');
});

function makeWorkbook() {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": xml(`
      <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      </Types>`),
    "_rels/.rels": xml(`
      <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`),
    "xl/workbook.xml": xml(`
      <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Startups" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`
      <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`),
    "xl/worksheets/sheet1.xml": xml(`
      <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <dimension ref="A1:C2"/>
        <sheetData>
          <row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>website</t></is></c><c r="C1" t="inlineStr"><is><t>pocName</t></is></c></row>
          <row r="2"><c r="A2" t="inlineStr"><is><t>Acme</t></is></c><c r="B2" t="inlineStr"><is><t>https://acme.test</t></is></c><c r="C2" t="inlineStr"><is><t>Ada, &quot;CEO&quot;</t></is></c></row>
        </sheetData>
      </worksheet>`),
  };
  return zipSync(files);
}

function xml(value: string) {
  return strToU8(value.trim());
}
