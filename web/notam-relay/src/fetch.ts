export const LIST_URL = "https://brin.iaa.gov.il/aeroinfo/AeroInfo.aspx?msgType=Notam";
export const DETAIL_URL_TEMPLATE = "https://brin.iaa.gov.il/MobileAeroinfo/maiDetails.aspx?rowID={rowId}&scrpos=0&mode=notam";

/** Honest identification of the scraper; the IAA can contact us through the URL. */
export const USER_AGENT = "OpenEFB-NOTAM-Relay/0.1 (+https://github.com/quartermint/openefb; open-source EFB; scrapes the public NOTAM page at most every 15 min)";

export type TextFetcher = (url: string) => Promise<string>;

/** Both IAA pages are served as windows-1255 (Hebrew); NOTAM text itself is ASCII. Web-standard APIs only (Workers and Node). */
export const httpFetcher: TextFetcher = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`IAA returned HTTP ${res.status} for ${url}`);
  return new TextDecoder("windows-1255").decode(await res.arrayBuffer());
};

export const detailUrl = (rowId: string) => DETAIL_URL_TEMPLATE.replace("{rowId}", encodeURIComponent(rowId));
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
