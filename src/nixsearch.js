// Live search against the same Elasticsearch backend that search.nixos.org
// uses. Runs entirely from the browser - the endpoint sends permissive CORS
// headers and the credentials below are the public read-only ones the official
// front end ships with.
//
// The index name carries a generation number that changes whenever the schema
// does, so it is discovered at runtime rather than hardcoded. If any of this
// fails the caller falls back to the bundled catalog, which is why every entry
// point resolves rather than throws.

const BASE = "https://search.nixos.org/backend";
const AUTH = "Basic " + btoa("aWVSALXpZv:X8gPHnzL52wFEekuxsfQ9cSh");

/** channel id -> index alias, resolved once per session. */
const indexCache = new Map();
let aliasesPromise = null;

export const searchState = { online: null, reason: "" };

const TIMEOUT_MS = 7000;
/** After a failure, fall back instantly for this long instead of hanging again. */
const COOLDOWN_MS = 60000;
let offlineUntil = 0;

/** The caller's abort signal, plus a timeout so a stalled network still resolves. */
function withTimeout(signal) {
  const timeout = AbortSignal.timeout
    ? AbortSignal.timeout(TIMEOUT_MS)
    : (() => {
        const c = new AbortController();
        setTimeout(() => c.abort(new Error("timed out")), TIMEOUT_MS);
        return c.signal;
      })();
  if (!signal) return timeout;
  return AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal;
}

/** Turn an abort caused by our own timeout into a plain, reportable error. */
function asFailure(e, signal) {
  if (e.name === "AbortError" && signal && !signal.aborted) return new Error("the search index did not respond");
  if (e.name === "TimeoutError") return new Error("the search index did not respond");
  return e;
}

function goOffline(reason) {
  offlineUntil = Date.now() + COOLDOWN_MS;
  searchState.online = false;
  searchState.reason = reason;
}

async function post(index, body, signal) {
  let res;
  try {
    res = await fetch(`${BASE}/${index}/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: AUTH },
      body: JSON.stringify(body),
      signal: withTimeout(signal),
    });
  } catch (e) {
    const err = asFailure(e, signal);
    if (err.name !== "AbortError") goOffline(err.message);
    throw err;
  }
  if (!res.ok) {
    goOffline(`search backend returned ${res.status}`);
    throw new Error(`search backend returned ${res.status}`);
  }
  return res.json();
}

async function loadAliases() {
  if (!aliasesPromise)
    aliasesPromise = fetch(`${BASE}/_aliases`, {
      headers: { Authorization: AUTH },
      signal: withTimeout(null),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((e) => {
        aliasesPromise = null;
        throw asFailure(e, null);
      });
  return aliasesPromise;
}

/** Newest index alias for a channel, e.g. latest-50-nixos-unstable. */
export async function resolveIndex(channel) {
  if (indexCache.has(channel)) return indexCache.get(channel);
  if (Date.now() < offlineUntil) throw new Error(searchState.reason || "offline");
  try {
    const aliases = await loadAliases();
    let best = null;
    for (const idx of Object.keys(aliases))
      for (const alias of Object.keys(aliases[idx].aliases || {})) {
        const m = alias.match(/^latest-(\d+)-nixos-(.+)$/);
        if (m && m[2] === channel && (!best || Number(best.gen) < Number(m[1])))
          best = { gen: m[1], alias };
      }
    if (!best) throw new Error(`no index published for ${channel}`);
    indexCache.set(channel, best.alias);
    searchState.online = true;
    return best.alias;
  } catch (e) {
    goOffline(e.message);
    throw e;
  }
}

const licenseOf = (src) => {
  const list = src.package_license || [];
  const names = list.map((l) => l.shortName || l.spdxId || l.fullName).filter(Boolean);
  return names.length ? [...new Set(names)].join(", ") : "unknown";
};

// nixpkgs marks unfree in meta, which the index exposes only through the
// licence entries, so we infer it from those.
const FREE_HINT = /^(mit|bsd|apache|gpl|lgpl|agpl|mpl|isc|zlib|epl|cc0|cc-by|artistic|unlicense|wtfpl|publicdomain|ofl|boost|psf|ncsa|postgresql|python|ruby|vim|zpl|hpnd|libpng|curl|openssl|sleepycat|eupl|osl|qpl|cecill|afl)/i;

function isUnfree(src) {
  const list = src.package_license || [];
  if (!list.length) return null; // genuinely unknown
  return !list.every((l) => {
    const key = String(l.shortName || l.spdxId || "");
    return FREE_HINT.test(key) || /-or-later$|-only$/.test(key);
  });
}

export function toEntry(src) {
  return {
    attr: src.package_attr_name,
    name: src.package_pname || src.package_attr_name,
    version: src.package_pversion || "",
    desc: src.package_description || "",
    longDesc: src.package_longDescription || "",
    home: (src.package_homepage || [])[0] || "",
    license: licenseOf(src),
    unfree: isUnfree(src),
    platforms: src.package_platforms || [],
    mainProgram: src.package_mainProgram || "",
    programs: src.package_programs || [],
    position: src.package_position || "",
    source: "nixpkgs",
  };
}

/**
 * Search nixpkgs. Mirrors the query shape the official front end uses: exact
 * attribute matches first, then prefix, then a loose multi-field match.
 */
export async function searchPackages(query, { channel = "26.05", system = "x86_64-linux", size = 30, signal } = {}) {
  const q = query.trim();
  if (!q) return [];
  const index = await resolveIndex(channel);
  const wildcard = `*${q.toLowerCase().replace(/\s+/g, "*")}*`;

  const body = {
    size,
    _source: [
      "package_attr_name", "package_pname", "package_pversion", "package_description",
      "package_longDescription", "package_homepage", "package_license", "package_platforms",
      "package_mainProgram", "package_programs", "package_position",
    ],
    query: {
      bool: {
        filter: [
          { term: { type: "package" } },
          { terms: { package_platforms: [system, "x86_64-linux", "aarch64-linux"] } },
        ],
        must: [{
          dis_max: {
            tie_breaker: 0.7,
            queries: [
              { term: { package_attr_name: { value: q, boost: 30 } } },
              { match: { package_attr_name: { query: q, boost: 12 } } },
              { wildcard: { package_attr_name: { value: wildcard, case_insensitive: true, boost: 6 } } },
              { match: { package_pname: { query: q, boost: 8 } } },
              { match: { package_programs: { query: q, boost: 4 } } },
              { match: { package_description: { query: q, boost: 1.5 } } },
              { match: { package_longDescription: { query: q, boost: 0.5 } } },
            ],
          },
        }],
      },
    },
  };

  const res = await post(index, body, signal);
  const seen = new Set();
  const out = [];
  for (const hit of res.hits?.hits || []) {
    const e = toEntry(hit._source);
    if (seen.has(e.attr)) continue;
    seen.add(e.attr);
    out.push(e);
  }
  return out;
}

/** Search NixOS module options, used by the "what can I configure" helper. */
export async function searchOptions(query, { channel = "26.05", size = 20, signal } = {}) {
  const q = query.trim();
  if (!q) return [];
  const index = await resolveIndex(channel);
  const body = {
    size,
    _source: ["option_name", "option_description", "option_type", "option_default", "option_example"],
    query: {
      bool: {
        filter: [{ term: { type: "option" } }],
        must: [{
          dis_max: {
            tie_breaker: 0.7,
            queries: [
              { term: { option_name: { value: q, boost: 30 } } },
              { prefix: { option_name: { value: q, boost: 10 } } },
              { wildcard: { option_name: { value: `*${q}*`, case_insensitive: true, boost: 5 } } },
              { match: { option_description: { query: q, boost: 1 } } },
            ],
          },
        }],
      },
    },
  };
  const res = await post(index, body, signal);
  return (res.hits?.hits || []).map((h) => ({
    name: h._source.option_name,
    desc: stripHtml(h._source.option_description || ""),
    type: h._source.option_type || "",
    default: h._source.option_default || "",
    example: h._source.option_example || "",
  }));
}

/** Fetch metadata for specific attribute names, e.g. to refresh a shared link. */
export async function lookupAttrs(attrs, { channel = "26.05", signal } = {}) {
  if (!attrs.length) return [];
  const index = await resolveIndex(channel);
  const res = await post(index, {
    size: attrs.length * 2,
    _source: [
      "package_attr_name", "package_pname", "package_pversion", "package_description",
      "package_homepage", "package_license", "package_platforms", "package_mainProgram",
    ],
    query: {
      bool: {
        filter: [{ term: { type: "package" } }],
        must: [{ terms: { package_attr_name: attrs } }],
      },
    },
  }, signal);
  return (res.hits?.hits || []).map((h) => toEntry(h._source));
}

function stripHtml(html) {
  return html
    .replace(/<rendered-html>|<\/rendered-html>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Offline fallback: substring match over the bundled catalog. */
export function searchCatalog(query, catalog) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (p) => {
    const attr = p.attr.toLowerCase();
    const name = p.name.toLowerCase();
    if (attr === q || name === q) return 100;
    if (attr.startsWith(q) || name.startsWith(q)) return 50;
    if (attr.includes(q) || name.includes(q)) return 25;
    if ((p.desc || "").toLowerCase().includes(q)) return 5;
    return 0;
  };
  return catalog.packages.items
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 30)
    .map((x) => ({
      attr: x.p.attr, name: x.p.name, desc: x.p.desc, home: x.p.home,
      license: x.p.unfree ? "unfree" : "", unfree: !!x.p.unfree,
      version: "", platforms: [], source: "catalog", catalogId: x.p.id,
    }));
}
