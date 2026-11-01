import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LIST_URL, detailUrl } from "../src/fetch.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** Fixtures are saved windows-1255 like the live site. */
export const fixtureText = (name: string) => new TextDecoder("windows-1255").decode(readFileSync(path.join(dir, "fixtures", name)));
export const rawNotam = (id: string) => readFileSync(path.join(dir, "fixtures", "raw", `${id.replace("/", "-")}.txt`), "utf8").trimEnd();

/** Same markup as the IAA mobile detail page, around arbitrary ICAO text. */
export function detailHtml(id: string, location: string, created: string, raw: string): string {
  const lines = raw
    .split("\n")
    .map((l) => `<tr><td><table class="TblResults"><tr><td colspan="3" class="DetailsBlueLine"><b>${l.padEnd(60)}</b></td></tr></table></td></tr>`)
    .join("");
  return `<html><body>
<span id="labelTitle">NOTAM NO: ${id}</span>
<span id="LabelRow1">Location Indicator: ${location}</span>
<span id="LabelRow2">Location Description: Tel-Aviv FIR</span>
<span id="LabelRow3">Created: ${created}</span>
<table id="TblResults">${lines}</table></body></html>`;
}

/** One list row in the page's markup. */
export function listRowHtml(rowId: string, id: string, location: string, summary: string): string {
  return `<div id="divMainInfo_${rowId}"><table><tr><td class="NotamID">${id}</td><td class="Location">${location}</td><td class="MsgText">${summary}</td></tr></table></div>`;
}

export const listPage = (rows: string[]) => `<html><body><table id="DataList1">${rows.join("")}</table></body></html>`;

export { LIST_URL, detailUrl };
