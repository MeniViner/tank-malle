/**
 * Generate the synthetic import fixtures.
 *
 * The fixtures carry the EXACT schema of the legacy Fuel Tracker workbook —
 * same sheet name, same 17 headers, same bidi marks, non-breaking spaces,
 * currency symbols, Hebrew units, comma-separated odometers, hyphen
 * placeholders and the "התחלת חישוב מחדש" marker — but entirely invented data.
 * No real user record is ever committed to this repository.
 *
 *   node scripts/makeImportFixtures.mjs
 */

import { writeFileSync } from "node:fs";
import { deflateRawSync, crc32 } from "node:zlib";

const OUT = new URL("../src/lib/import/__fixtures__/", import.meta.url);

const RLM = "‏";
const NBSP = " ";

const HEADERS = [
  "הרכב הנבחר",
  "תאריך",
  "שעה",
  "כמות דלק",
  "מחיר כולל",
  "ממוצע מחיר ליחידת נפח",
  "קילומטראז'",
  "סוג דלק",
  "תחנת דלק",
  "מרחק קודם",
  "ימים",
  "ממוצע מרחק ליחידת נפח",
  "ממוצע צריכה ל-100",
  "ממוצע עלות למרחק",
  "מרחק ליום",
  "ממוצע עלות יומית",
  "הערות",
];

const money = (n) => `${RLM}${n.toFixed(2)}${NBSP}${RLM}₪`;
const km = (n) => `${n.toLocaleString("en-US")} ק"מ`;
const RESET = "התחלת חישוב מחדש";

/** [date, time, liters, totalCost, pricePerLiter, odometer, station, reset] */
const DATA = [
  ["2026-01-04", "08:12", 31.5, 236.25, 7.5, 120_000, "-", false],
  ["2026-01-11", "17:40", 12.0, 90.0, 7.5, 120_180, "תחנה א", false],
  ["2026-01-19", "09:05", 28.4, 213.0, 7.5, 120_520, "-", false],
  ["2026-02-02", "14:22", 33.1, 251.56, 7.6, 120_900, "תחנה ב", false],
  // Undocumented fill-ups happened here; the legacy tool restarted its maths.
  ["2026-03-15", "20:54", 30.0, 228.0, 7.6, 123_400, "-", true],
  ["2026-03-20", "16:07", 34.0, 258.4, 7.6, 123_800, "-", false],
  ["2026-03-28", "11:30", 29.8, 226.48, 7.6, 124_150, "תחנה ג", false],
];

function legacyRow(entry, index) {
  const [date, time, liters, total, price, odo, station, reset] = entry;
  const derived = reset
    ? Array(7).fill(RESET)
    : index === 0
      ? ["- ק\"מ", "-", "- ק\"מ/ליטר", "- ליטר/100 ק\"מ", "-", "- ק\"מ", "-"]
      : [
          km(odo - DATA[index - 1][5]),
          String(index),
          "10.5 ק\"מ/ליטר",
          "9.52 ליטר/100 ק\"מ",
          money(0.72),
          km(40),
          money(30),
        ];

  return [
    "Imported Fuel Data 2026",
    date,
    time,
    String(liters),
    money(total),
    money(price),
    km(odo),
    "בנזין 95",
    station,
    ...derived,
    index === 0 ? "מקור: ייבוא" : "-",
  ];
}

const TABLE = [HEADERS, ...DATA.map(legacyRow)];

/* ---------- CSV ---------- */

const escape = (value) =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

writeFileSync(
  new URL("legacy-fuel-tracker.csv", OUT),
  `﻿${TABLE.map((row) => row.map(escape).join(",")).join("\r\n")}\r\n`,
  "utf8",
);

/* ---------- XLSX ---------- */

const xmlEscape = (value) =>
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

const sheetRows = TABLE.map(
  (row, r) =>
    `<row r="${r + 1}">${row
      .map(
        (cell, c) =>
          `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`,
      )
      .join("")}</row>`,
).join("");

const PARTS = {
  "[Content_Types].xml":
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    "</Types>",
  "_rels/.rels":
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>",
  "xl/workbook.xml":
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Fuel Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels":
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    "</Relationships>",
  "xl/worksheets/sheet1.xml":
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${sheetRows}</sheetData></worksheet>`,
};

/** Deflated ZIP, so the fixture exercises the same inflate path a real file does. */
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
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(8, 8); // deflate
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

writeFileSync(new URL("legacy-fuel-tracker.xlsx", OUT), zip(PARTS));

console.log("wrote legacy-fuel-tracker.csv and legacy-fuel-tracker.xlsx");
