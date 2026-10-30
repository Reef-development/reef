import { describe, expect, it } from "vitest";
import { BOM, exportFilename, toCsv } from "../src/services/csv.js";
import { testApp } from "./fakes.js";

type Row = { name: string; tons: number; note: string | null };

const columns = [
  { header: "Name", value: (r: Row) => r.name },
  { header: "Tons", value: (r: Row) => r.tons.toFixed(2) },
  { header: "Note", value: (r: Row) => r.note },
];

describe("the spreadsheet export", () => {
  it("starts with the byte order mark", () => {
    // Excel reads the file as the machine's local code page without it, so every Rand sign and
    // every accented name arrives as mojibake. It is invisible in an editor, which is exactly
    // why it gets deleted by somebody tidying up. This test is what stops that.
    const csv = toCsv([{ name: "Alpha", tons: 1, note: null }], columns);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.codePointAt(0)).toBe(0xfeff);
  });

  it("ends every line with a carriage return and a line feed", () => {
    const csv = toCsv([{ name: "Alpha", tons: 1, note: null }], columns);
    expect(csv).toContain("\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("writes an empty cell for a missing value rather than the word null", () => {
    const csv = toCsv([{ name: "Alpha", tons: 1, note: null }], columns);
    expect(csv).toContain("Alpha,1.00,\r\n");
  });

  it("quotes a cell containing a comma, a quote or a newline", () => {
    const csv = toCsv([{ name: 'Say "hi", now', tons: 1, note: "two\nlines" }], columns);
    expect(csv).toContain('"Say ""hi"", now"');
    expect(csv).toContain('"two\nlines"');
  });

  it("stops a cell that starts with an equals sign becoming a formula", () => {
    // A note typed by a worker must not run when the file is opened. The apostrophe makes the
    // cell text, and Excel does not display it.
    const csv = toCsv([{ name: "=1+1", tons: 1, note: "@SUM(A1:A9)" }], columns);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@SUM(A1:A9)");
    expect(csv).not.toContain(",=1+1,");
  });

  it("writes the header row even when there is nothing to export", () => {
    const csv = toCsv([] as Row[], columns);
    expect(csv).toBe(`${BOM}Name,Tons,Note\r\n`);
  });

  it("names the file so a person can find it again", () => {
    expect(exportFilename("reef-monthly", ["Mokopane Plant 2", "2026-08"])).toBe(
      "reef-monthly-mokopane-plant-2-2026-08.csv",
    );
  });
});

describe("the export endpoint", () => {
  it("sends a downloadable spreadsheet, with the mark intact through the HTTP layer", async () => {
    const { call, analytics } = testApp();
    analytics.sites = [{ id: "00000000-0000-4000-8000-0000000000a1", name: "Alpha" }];
    analytics.production = [
      {
        mine_id: "00000000-0000-4000-8000-0000000000a1",
        date: "2026-08-03",
        tons: 1200,
        magnetite: 100,
        overtime: 50,
      },
    ];
    const res = await call(
      "GET",
      "/api/v1/reports/monthly.csv?month=2026-08&mine_id=00000000-0000-4000-8000-0000000000a1",
      { token: "owner-token" },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("reef-monthly-alpha-2026-08.csv");
    // Checked as bytes, not as text. Reading the response with .text() decodes it as UTF-8,
    // and the decoder strips a leading byte order mark by specification, so a test written
    // against the string passes whether the mark was ever sent or not. The three bytes below
    // are the mark, and they are what Excel actually reads.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain("2026-08-03");
  });

  it("refuses a worker, like the report it is a copy of", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/reports/monthly.csv?month=2026-08", {
      token: "worker-token",
    });
    expect(res.status).toBe(403);
  });
});
