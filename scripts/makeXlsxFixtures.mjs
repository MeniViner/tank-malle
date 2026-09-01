#!/usr/bin/env node
/**
 * Generate XLSX fixtures covering the structural variants real spreadsheets
 * produce.
 *
 * The reader is hand-written, so "it works on the one file we have" is not
 * evidence. These fixtures encode the ways Excel and Google Sheets actually
 * differ, plus the cell shapes that have historically broken naive parsers.
 *
 * All data is invented. No real user record is ever committed.
 *
 *   node scripts/makeXlsxFixtures.mjs
 */

import { writeFileSync } from "node:fs";
import { deflateRawSync, crc32 } from "node:zlib";

const OUT = new URL("../src/lib/import/__fixtures__/", import.meta.url);

const RLM = "‏";
const LRM = "‎";
const NBSP = " ";
const NNBSP = " ";

const xml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const columnName = (index) => {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - rem) / 26);
  }
  return name;
};

/* ---------------- zip ---------------- */

function zip(parts) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of Object.entries(parts)) {
    const nameBytes = Buffer.from(name, "utf8");
    const raw = Buffer.from(text, "utf8");
    const deflated = deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, deflated);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(deflated.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += local.length + nameBytes.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(parts).length, 8);
  eocd.writeUInt16LE(Object.keys(parts).length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuffer, eocd]);
}

/* ---------------- package scaffolding ---------------- */

function contentTypes(sheetCount, extras = []) {
  const overrides = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    overrides +
    extras.join("") +
    "</Types>"
  );
}

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

function workbookXml(sheets) {
  const tags = sheets
    .map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${tags}</sheets></workbook>`
  );
}

function workbookRels(sheetCount, { sharedStrings = false, styles = false } = {}) {
  const sheetRels = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("");
  let next = sheetCount + 1;
  let extra = "";
  if (sharedStrings) {
    extra += `<Relationship Id="rId${next++}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`;
  }
  if (styles) {
    extra += `<Relationship Id="rId${next++}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheetRels +
    extra +
    "</Relationships>"
  );
}

/* ---------------- 1. Excel style: shared strings, styled date serials ------- */

const HEADERS = [
  "תאריך",
  "שעה",
  "קילומטראז'",
  "כמות דלק",
  "מחיר כולל",
  "סוג דלק",
  "תחנת דלק",
  "הערות",
];

/** Days since 1899-12-30, which is how Excel stores a date. */
function excelSerial(year, month, day) {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function excelWorkbook() {
  // Shared strings, in first-use order, as Excel writes them.
  const shared = [
    ...HEADERS,
    "בנזין 95",
    `פז${NBSP}חגור`,
    "מקור: ייבוא",
    "סונול אשקלון",
    "",
  ];
  const index = (value) => shared.indexOf(value);

  // Style 1 is a date format, style 2 a time format; style 0 is General.
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
    "<cellXfs count=\"3\">" +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="20" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    "</cellXfs></styleSheet>";

  const rows = [];

  // Header row, as shared strings.
  rows.push(
    `<row r="1">${HEADERS.map(
      (h, c) => `<c r="${columnName(c)}1" t="s"><v>${index(h)}</v></c>`,
    ).join("")}</row>`,
  );

  /** [dateSerial, timeFraction, odometer, liters, total, station, note] */
  const data = [
    [excelSerial(2026, 1, 5), 8 / 24 + 30 / 1440, 100000, 31.5, 236.25, "פז חגור", "מקור: ייבוא"],
    [excelSerial(2026, 1, 19), 18 / 24 + 47 / 1440, 100420, 28.4, 213.0, "סונול אשקלון", null],
    [excelSerial(2026, 2, 2), 9 / 24 + 5 / 1440, 100850, 33.1, 251.56, null, null],
  ];

  data.forEach((entry, r) => {
    const row = r + 2;
    const [serial, time, odo, liters, total, station, note] = entry;
    const cells = [
      `<c r="A${row}" s="1"><v>${serial}</v></c>`,
      `<c r="B${row}" s="2"><v>${time}</v></c>`,
      `<c r="C${row}"><v>${odo}</v></c>`,
      `<c r="D${row}"><v>${liters}</v></c>`,
      `<c r="E${row}"><v>${total}</v></c>`,
      `<c r="F${row}" t="s"><v>${index("בנזין 95")}</v></c>`,
      // An EMPTY cell is simply omitted by Excel, not written as empty.
      station ? `<c r="G${row}" t="s"><v>${index(station)}</v></c>` : "",
      note ? `<c r="H${row}" t="s"><v>${index(note)}</v></c>` : "",
    ].join("");
    rows.push(`<row r="${row}">${cells}</row>`);
  });

  return zip({
    "[Content_Types].xml": contentTypes(1, [
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ]),
    "_rels/.rels": ROOT_RELS,
    "xl/workbook.xml": workbookXml(["Fuel Data"]),
    "xl/_rels/workbook.xml.rels": workbookRels(1, { sharedStrings: true, styles: true }),
    "xl/styles.xml": styles,
    "xl/sharedStrings.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
      shared
        .map((value) => `<si><t xml:space="preserve">${xml(value)}</t></si>`)
        .join("") +
      "</sst>",
    "xl/worksheets/sheet1.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<dimension ref="A1:H4"/><sheetData>${rows.join("")}</sheetData></worksheet>`,
  });
}

/* ---------------- 2. Google Sheets style: inline strings, text dates -------- */

function sheetsWorkbook() {
  const rows = [];

  const inline = (ref, value) =>
    `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  const number = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;

  rows.push(`<row r="1">${HEADERS.map((h, c) => inline(`${columnName(c)}1`, h)).join("")}</row>`);

  // Dates and numbers as TEXT, with bidi marks, currency, units and both a
  // thousands comma and a decimal comma — the shapes an RTL export produces.
  const data = [
    {
      date: "05/01/2026",
      time: "08:30",
      odo: `100,000${NBSP}ק"מ`,
      liters: "31,5",
      total: `${RLM}236.25${NNBSP}${RLM}₪`,
      fuel: "בנזין 95",
      station: `${LRM}פז חגור${LRM}`,
      note: "",
    },
    {
      date: "2026-01-19",
      time: "18:47",
      odo: `100,420${NBSP}ק"מ`,
      liters: "28.4",
      total: `${RLM}213.00${NNBSP}${RLM}₪`,
      fuel: "בנזין 95",
      station: "-",
      note: "-",
    },
  ];

  data.forEach((entry, r) => {
    const row = r + 2;
    rows.push(
      `<row r="${row}">` +
        inline(`A${row}`, entry.date) +
        inline(`B${row}`, entry.time) +
        inline(`C${row}`, entry.odo) +
        inline(`D${row}`, entry.liters) +
        inline(`E${row}`, entry.total) +
        inline(`F${row}`, entry.fuel) +
        inline(`G${row}`, entry.station) +
        inline(`H${row}`, entry.note) +
        "</row>",
    );
  });

  // A trailing row of nothing but empty cells, which Sheets does emit.
  rows.push(
    `<row r="4">${HEADERS.map((_, c) => number(`${columnName(c)}4`, "")).join("")}</row>`,
  );

  return zip({
    "[Content_Types].xml": contentTypes(1),
    "_rels/.rels": ROOT_RELS,
    "xl/workbook.xml": workbookXml(["Fuel Data"]),
    "xl/_rels/workbook.xml.rels": workbookRels(1),
    "xl/worksheets/sheet1.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData>${rows.join("")}</sheetData></worksheet>`,
  });
}

/* ---------------- 3. Multiple worksheets ----------------------------------- */

function multiSheetWorkbook() {
  const notes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>הערות כלליות</t></is></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>הגיליון הזה אינו נתוני תדלוק</t></is></c></row>' +
    "</sheetData></worksheet>";

  const inline = (ref, value) =>
    `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;

  const rows = [
    `<row r="1">${HEADERS.map((h, c) => inline(`${columnName(c)}1`, h)).join("")}</row>`,
    `<row r="2">${[
      "2026-03-01",
      "07:15",
      "200000",
      "40",
      "312.40",
      "סולר",
      "דור אלון",
      "",
    ]
      .map((v, c) => inline(`${columnName(c)}2`, v))
      .join("")}</row>`,
  ];

  return zip({
    "[Content_Types].xml": contentTypes(2),
    "_rels/.rels": ROOT_RELS,
    // The data sheet is SECOND. A reader that assumes sheet one is wrong.
    "xl/workbook.xml": workbookXml(["Notes", "Fuel Data"]),
    "xl/_rels/workbook.xml.rels": workbookRels(2),
    "xl/worksheets/sheet1.xml": notes,
    "xl/worksheets/sheet2.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData>${rows.join("")}</sheetData></worksheet>`,
  });
}

/* ---------------- 4. Formulas with cached values --------------------------- */

function formulaWorkbook() {
  const inline = (ref, value) =>
    `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;

  const rows = [
    `<row r="1">${HEADERS.map((h, c) => inline(`${columnName(c)}1`, h)).join("")}</row>`,
    // Total is a FORMULA whose cached value is present. Liters is plain.
    '<row r="2">' +
      inline("A2", "2026-04-01") +
      inline("B2", "12:00") +
      '<c r="C2"><v>300000</v></c>' +
      '<c r="D2"><v>40</v></c>' +
      '<c r="E2"><f>D2*7.5</f><v>300</v></c>' +
      inline("F2", "בנזין 95") +
      inline("G2", "פז") +
      "</row>",
    // Odometer itself is a formula — a raw input the user did not type.
    '<row r="3">' +
      inline("A3", "2026-04-10") +
      inline("B3", "12:00") +
      '<c r="C3"><f>C2+400</f><v>300400</v></c>' +
      '<c r="D3"><v>38</v></c>' +
      '<c r="E3"><v>285</v></c>' +
      inline("F3", "בנזין 95") +
      inline("G3", "פז") +
      "</row>",
    // A formula that evaluated to an ERROR. There is no usable value at all.
    '<row r="4">' +
      inline("A4", "2026-04-20") +
      inline("B4", "12:00") +
      '<c r="C4"><v>300800</v></c>' +
      '<c r="D4" t="e"><f>1/0</f><v>#DIV/0!</v></c>' +
      '<c r="E4"><v>290</v></c>' +
      inline("F4", "בנזין 95") +
      inline("G4", "פז") +
      "</row>",
  ];

  return zip({
    "[Content_Types].xml": contentTypes(1),
    "_rels/.rels": ROOT_RELS,
    "xl/workbook.xml": workbookXml(["Fuel Data"]),
    "xl/_rels/workbook.xml.rels": workbookRels(1),
    "xl/worksheets/sheet1.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData>${rows.join("")}</sheetData></worksheet>`,
  });
}

/* ---------------- write ---------------- */

writeFileSync(new URL("xlsx-excel-shared-strings.xlsx", OUT), excelWorkbook());
writeFileSync(new URL("xlsx-sheets-inline-strings.xlsx", OUT), sheetsWorkbook());
writeFileSync(new URL("xlsx-multi-sheet.xlsx", OUT), multiSheetWorkbook());
writeFileSync(new URL("xlsx-formulas.xlsx", OUT), formulaWorkbook());

console.log("wrote 4 xlsx structural fixtures");
