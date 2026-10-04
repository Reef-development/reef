/**
 * The spreadsheet export.
 *
 * Three things here exist because of how Excel behaves, not because of anything in the brief,
 * and each has been removed by somebody tidying up at least once on a project like this.
 */

/**
 * Excel reads a file as the machine's local code page unless the file opens with this mark, so
 * without it every Rand sign and every accented name arrives as mojibake. It is invisible in a
 * text editor, which is exactly why it gets deleted.
 */
export const BOM = "﻿";

/** Excel is happiest with carriage return and line feed, whatever platform wrote the file. */
const EOL = "\r\n";

/**
 * A cell beginning with one of these is treated as a formula when the file is opened, so a name
 * or a note typed by a worker becomes something the spreadsheet runs. Prefixing with an
 * apostrophe makes the cell text; Excel shows the value and not the apostrophe.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export type Column<Row> = { header: string; value: (row: Row) => unknown };

/** Rows as a spreadsheet Excel will open correctly, as text ready to be sent. */
export function toCsv<Row>(rows: readonly Row[], columns: readonly Column<Row>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(","));
  }
  return BOM + lines.join(EOL) + EOL;
}

/** A file name a browser will accept and a person can find again. */
export function exportFilename(prefix: string, parts: readonly string[]): string {
  const safe = [prefix, ...parts]
    .map((p) => p.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-");
  return `${safe.toLowerCase()}.csv`;
}
