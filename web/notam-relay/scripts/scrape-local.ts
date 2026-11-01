/**
 * Fallback for when the IAA blocks Cloudflare's addresses: run the same scrape from any always-on
 * machine (`npm run scrape`), then publish with `npm run publish-local`. Files live in ./.data;
 * the feed is also copied to ./out/notams.json for any static host.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FEED_FILE, runScrapeJob } from "../src/job.js";
import type { Store } from "../src/storage.js";

const dir = path.resolve(".data");
const store: Store = {
  async get(name) {
    try {
      return await readFile(path.join(dir, name), "utf8");
    } catch {
      return null;
    }
  },
  async put(name, body) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), body);
  },
};

const started = Date.now();
const outcome = await runScrapeJob(store, { force: process.argv.includes("--force"), maxDetailRequests: Infinity });
if (outcome.status === "ok") {
  await mkdir("out", { recursive: true });
  await copyFile(path.join(dir, FEED_FILE), path.join("out", FEED_FILE));
  console.log(`ok in ${((Date.now() - started) / 1000).toFixed(1)}s`, JSON.stringify(outcome.meta.lastStats));
} else if (outcome.status === "skipped") {
  console.log(`skipped (rate limit); next allowed at ${outcome.nextAllowedAt}; pass --force to override`);
} else {
  console.error(`scrape failed: ${outcome.error}`);
  process.exitCode = 1;
}
