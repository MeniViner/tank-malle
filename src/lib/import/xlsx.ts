/**
 * Minimal .xlsx reader: one worksheet out to a table of primitive cells.
 *
 * Parsed entirely in the browser — the workbook never leaves the device. The
 * whole module (and the ZIP reader it depends on) is lazy-loaded when the user
 * enters the import flow, so it costs the initial bundle nothing.
 */

import { excelSerialToDate } from "./normalize";
import { canReadZip, openZip, readZipText, UnsupportedArchiveError } from "./zip";

export { UnsupportedArchiveError, canReadZip };

export type Cell = string | number | boolean | Date | null;

export interface Sheet {
  name: string;
  /** Rows of primitive cells. Dates arrive as Date, numbers as number. */
  rows: Cell[][];
  /**
   * Which cells were produced by a FORMULA rather than typed.
   *
   * A cached formula result is the only value a reader can see, and it is
   * usually right — but it is not something the user entered, and a stale
   * cache or a workbook edited without recalculation can make it wrong. The
   * importer surfaces this in the preview rather than either refusing the file
   * or pretending the value is raw input.
   */
  formulas: boolean[][];
}

/* --- tiny XML helpers. The files here are machine-written and regular, so a
   full DOM parser would be overkill; DOMParser is also unavailable in the
   Node test environment. --- */

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : null;
}

/** "BC12" → 54 (zero-based column index). */
function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Concatenate every <t> inside a shared-string or inline-string block. */
function textOf(fragment: string): string {
  const parts = [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
  return decodeEntities(parts.map((part) => part[1]).join(""));
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]));
}

/** Built-in numeric formats that denote a date or a time. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * Which cell styles mean "this number is a date".
 *
 * A custom format counts when its code contains date or time tokens outside
 * the quoted literal sections — the quoting matters, because a format like
 * `"上午/下午 "hh"時"` is mostly literal text.
 */
function parseDateStyles(stylesXml: string | null): Set<number> {
  const dateStyles = new Set<number>();
  if (!stylesXml) return dateStyles;

  const customDateFormats = new Set<number>();
  for (const match of stylesXml.matchAll(/<numFmt\s[^>]*\/>/g)) {
    const tag = match[0];
    const id = Number(attr(tag, "numFmtId"));
    const code = attr(tag, "formatCode") ?? "";
    const unquoted = code.replace(/"[^"]*"/g, "").replace(/\\./g, "");
    if (/[ymdhs]/i.test(unquoted)) customDateFormats.add(id);
  }

  const cellXfs = stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? "";
  const entries = [...cellXfs.matchAll(/<xf\s[^>]*?(?:\/>|>)/g)];
  entries.forEach((match, index) => {
    const id = Number(attr(match[0], "numFmtId") ?? "0");
    if (BUILTIN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dateStyles.add(index);
  });

  return dateStyles;
}

function parseSheet(
  xml: string,
  shared: string[],
  dateStyles: Set<number>,
): { rows: Cell[][]; formulas: boolean[][] } {
  const rows: Cell[][] = [];
  const formulas: boolean[][] = [];

  for (const rowMatch of xml.matchAll(/<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowIndex = Number(rowMatch[1]) - 1;
    const cells: Cell[] = [];
    const cellFormulas: boolean[] = [];

    for (const cellMatch of rowMatch[2].matchAll(
      /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const tag = `<c ${cellMatch[1]}>`;
      const body = cellMatch[2] ?? "";
      const reference = attr(tag, "r") ?? "";
      const type = attr(tag, "t") ?? "n";
      const style = Number(attr(tag, "s") ?? "-1");
      const index = reference ? columnIndex(reference) : cells.length;

      const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const isFormula = /<f[\s>]/.test(body);
      let value: Cell = null;

      if (type === "s") {
        const at = Number(rawValue);
        value = Number.isInteger(at) ? (shared[at] ?? null) : null;
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else if (type === "str") {
        value = rawValue === undefined ? null : decodeEntities(rawValue);
      } else if (type === "b") {
        value = rawValue === "1";
      } else if (type === "e") {
        value = null;
      } else if (type === "d") {
        value = rawValue ? new Date(rawValue) : null;
      } else if (rawValue !== undefined && rawValue.trim() !== "") {
        // An empty <v></v> is an empty cell, not the number zero. Google
        // Sheets emits those for trailing columns.
        const numeric = Number(rawValue);
        value = Number.isFinite(numeric)
          ? dateStyles.has(style)
            ? (excelSerialToDate(numeric) ?? numeric)
            : numeric
          : null;
      }

      while (cells.length < index) {
        cells.push(null);
        cellFormulas.push(false);
      }
      cells[index] = value;
      cellFormulas[index] = isFormula;
    }

    while (rows.length < rowIndex) {
      rows.push([]);
      formulas.push([]);
    }
    rows[rowIndex] = cells;
    formulas[rowIndex] = cellFormulas;
  }

  return { rows, formulas };
}

/**
 * Read the first worksheet (or a named one) from an .xlsx file.
 * Throws UnsupportedArchiveError when the runtime cannot inflate.
 */
export async function readWorkbook(
  buffer: ArrayBuffer,
  sheetName?: string,
): Promise<Sheet> {
  const entries = openZip(buffer);

  const workbookXml = await readZipText(buffer, entries, "xl/workbook.xml");
  if (!workbookXml) throw new UnsupportedArchiveError("no workbook part");

  const sheetTags = [...workbookXml.matchAll(/<sheet\s[^>]*\/>/g)].map((m) => m[0]);
  if (sheetTags.length === 0) throw new UnsupportedArchiveError("workbook has no sheets");

  const chosen =
    (sheetName
      ? sheetTags.find((tag) => attr(tag, "name") === sheetName)
      : undefined) ?? sheetTags[0];

  const name = attr(chosen, "name") ?? "Sheet1";
  const relId = attr(chosen, "r:id") ?? attr(chosen, "id");

  // Resolve the relationship to a part name, falling back to the conventional
  // path when the rels part is missing.
  let target = `worksheets/sheet${sheetTags.indexOf(chosen) + 1}.xml`;
  const relsXml = await readZipText(buffer, entries, "xl/_rels/workbook.xml.rels");
  if (relsXml && relId) {
    for (const match of relsXml.matchAll(/<Relationship\s[^>]*\/>/g)) {
      if (attr(match[0], "Id") === relId) {
        target = (attr(match[0], "Target") ?? target).replace(/^\/?xl\//, "");
        break;
      }
    }
  }

  const sheetXml = await readZipText(buffer, entries, `xl/${target}`);
  if (!sheetXml) throw new UnsupportedArchiveError(`missing sheet part xl/${target}`);

  const shared = parseSharedStrings(
    await readZipText(buffer, entries, "xl/sharedStrings.xml"),
  );
  const dateStyles = parseDateStyles(await readZipText(buffer, entries, "xl/styles.xml"));

  const { rows, formulas } = parseSheet(sheetXml, shared, dateStyles);
  return { name, rows, formulas };
}

/** Every sheet name, for the picker when a workbook has more than one. */
export async function listSheetNames(buffer: ArrayBuffer): Promise<string[]> {
  const entries = openZip(buffer);
  const workbookXml = await readZipText(buffer, entries, "xl/workbook.xml");
  if (!workbookXml) return [];
  return [...workbookXml.matchAll(/<sheet\s[^>]*\/>/g)]
    .map((match) => attr(match[0], "name"))
    .filter((name): name is string => name !== null);
}
