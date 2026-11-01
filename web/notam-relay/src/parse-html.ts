import type { DetailMeta } from "./parse-notam.js";

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function htmlText(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
      if (ent[0] === "#") {
        const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[ent.toLowerCase()] ?? whole;
    });
}

export interface ListRow {
  /** IAA row id, from `divMainInfo_<n>` */
  rowId: string;
  /** NOTAM number, e.g. C2269/26 */
  id: string;
  location: string;
  /** the truncated message text shown in the list (used to detect edits) */
  summary: string;
}

/** One entry per `divMainInfo_<n>` block of the AeroInfo NOTAM list page. */
export function parseListHtml(html: string): ListRow[] {
  const starts = [...html.matchAll(/id="divMainInfo_(\d+)"/g)];
  const rows: ListRow[] = [];
  starts.forEach((m, i) => {
    const block = html.slice(m.index ?? 0, starts[i + 1]?.index ?? html.length);
    const id = /class="NotamID"[^>]*>([\s\S]*?)<\/td>/.exec(block);
    const loc = /class="Location"[^>]*>([\s\S]*?)<\/td>/.exec(block);
    const text = [...block.matchAll(/class="MsgText"[^>]*>([\s\S]*?)<\/td>/g)]
      .map((t) => htmlText(t[1]!).replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ");
    const notamId = id ? htmlText(id[1]!).trim() : "";
    if (!notamId) return;
    rows.push({ rowId: m[1]!, id: notamId, location: loc ? htmlText(loc[1]!).trim() : "", summary: text });
  });
  return rows;
}

export interface DetailPage {
  meta: DetailMeta;
  /** NOTAM number from the page title, e.g. C2269/26 */
  id: string | null;
  /** verbatim ICAO text, one line per source line, trailing blanks trimmed */
  raw: string;
}

/** "25/10/2026 14:31" (UTC) → ISO 8601. */
export function parseSiteDate(s: string): string | null {
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The mobile detail page (`maiDetails.aspx?mode=notam`). Returns null when it holds no NOTAM text. */
export function parseDetailHtml(html: string, rowId: string): DetailPage | null {
  const lines = [...html.matchAll(/DetailsBlueLine"[^>]*><b>([\s\S]*?)<\/b>/g)].map((m) =>
    htmlText(m[1]!).replace(/\s+$/, ""),
  );
  if (lines.length === 0) return null;
  const label = (id: string) => {
    const m = new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</span>`).exec(html);
    return m ? htmlText(m[1]!).trim() : "";
  };
  const title = /NOTAM NO:\s*([A-Z]\d{4}\/\d{2})/.exec(label("labelTitle"));
  const location = /Location Indicator:\s*(\S+)/.exec(label("LabelRow1"));
  const description = /Location Description:\s*(.*)$/.exec(label("LabelRow2"));
  return {
    id: title?.[1] ?? null,
    raw: lines.join("\n"),
    meta: {
      rowId,
      location: location?.[1] ?? "",
      locationDescription: description?.[1]?.trim() || null,
      created: parseSiteDate(label("LabelRow3")),
    },
  };
}
