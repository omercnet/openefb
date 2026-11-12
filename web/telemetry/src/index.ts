import { handleFetch, type Env } from "./handler.js";

export default {
  fetch: (request: Request, env: Env) => handleFetch(request, env),
};
