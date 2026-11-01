import { handleFetch, type Env } from "./handler.js";
import { runScrapeJob } from "./job.js";
import { kvStore } from "./storage.js";

// A Worker entry module may only export handlers, so everything else lives in handler.ts.
export default {
  fetch: (request: Request, env: Env) => handleFetch(request, env),

  /** Cron Trigger, every 15 minutes (wrangler.toml). */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const outcome = await runScrapeJob(kvStore(env.NOTAM_KV));
    console.log(JSON.stringify(outcome));
  },
};
