// Parsers for the document formats Amazon reports use. Pure functions over text; no I/O.

/** Tab-separated report with a header line (SP-API flat files). Empty trailing lines are ignored. */
export function parseTsv(text: string): Record<string, string>[] {
  return parseDelimited(text, "\t");
}

/** Comma-separated with RFC 4180 quoting (Ads CSV parts). */
export function parseCsv(text: string): Record<string, string>[] {
  return parseDelimited(text, ",");
}

function parseDelimited(text: string, delimiter: string): Record<string, string>[] {
  const records = splitRecords(text.replace(/^﻿/, ""), delimiter);
  const header = records.shift();
  if (!header) return [];
  const names = header.map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const rec of records) {
    if (rec.length === 1 && rec[0] === "") continue;
    const row: Record<string, string> = {};
    names.forEach((name, i) => {
      row[name] = rec[i] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function splitRecords(text: string, delimiter: string): string[][] {
  const out: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      out.push(record);
      record = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || record.length) {
    record.push(field);
    out.push(record);
  }
  return out;
}

/** Ads CSV parts repeat their header line: parse each part and concatenate the rows. */
export const parseCsvParts = (parts: readonly string[]): Record<string, string>[] =>
  parts.flatMap((p) => parseCsv(p));

/** JSON array, or JSON Lines (one value per line), or an object with the array under `key`. */
export function parseJsonRecords(text: string, key?: string): unknown[] {
  const t = text.trim();
  if (t === "") return [];
  if (t.startsWith("[")) return JSON.parse(t) as unknown[];
  if (t.startsWith("{") && !t.includes("\n")) {
    const obj = JSON.parse(t) as Record<string, unknown>;
    if (key) {
      const v = obj[key];
      return Array.isArray(v) ? v : [];
    }
    return [obj];
  }
  return t
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as unknown);
}

const decodeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * Flat XML records: every `<recordTag>…</recordTag>` becomes `{ child: text }` for its direct children.
 * Deliberately small (no attributes, no nesting); a slice that needs more brings a real parser.
 */
export function parseXmlRecords(text: string, recordTag: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const record = new RegExp(`<${recordTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${recordTag}>`, "g");
  for (const m of text.matchAll(record)) {
    const row: Record<string, string> = {};
    for (const c of (m[1] ?? "").matchAll(/<([A-Za-z_][\w.-]*)>([\s\S]*?)<\/\1>/g)) {
      row[c[1] as string] = decodeXml((c[2] ?? "").trim());
    }
    rows.push(row);
  }
  return rows;
}
