// Path joining for URI-style roots ("file:///data/x") and plain paths. Platform-free.

/** Joins parts with "/", collapsing repeated slashes but keeping the "scheme://" or "scheme:///" prefix of the first part
 * intact (a naive collapse turns `file:///data` into `file://data`, which makes `data` the authority). */
export function joinPath(...parts: string[]): string {
  const joined = parts.join('/');
  const m = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/\/?/.exec(joined);
  const prefix = m ? m[0] : '';
  const rest = joined.slice(prefix.length).replace(/\/{2,}/g, '/');
  return prefix + (prefix ? rest.replace(/^\//, '') : rest);
}
