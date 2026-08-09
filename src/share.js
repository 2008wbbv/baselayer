// Getting the generated files off the page: download, clipboard, a shareable
// link, and a one-liner you can paste into the NixOS installer.
//
// The site is static, so there is no server that could hand out a generated
// file at a URL. Instead the payload travels inside the command itself: the
// static host serves a fixed installer script, and the compressed config is
// passed to it as an argument. That keeps the whole thing hostable on plain
// file hosting like Neocities, with no backend and no account.

const BUNDLE_MAGIC = "###baselayer/1";

/** Pack files into the line-oriented format get.txt knows how to split. */
export function packFiles(files) {
  const parts = [BUNDLE_MAGIC];
  for (const f of files) {
    parts.push(`###FILE ${f.name}`);
    parts.push(f.content.replace(/\n$/, ""));
  }
  return parts.join("\n") + "\n";
}

const b64url = (bytes) => {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function gzip(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Compressed, URL-safe payload. The leading digit tells the shell script
 * whether it needs to decompress: 1 = gzip, 0 = plain.
 */
export async function buildPayload(files) {
  const raw = new TextEncoder().encode(packFiles(files));
  const packed = await gzip(raw);
  return packed && packed.length < raw.length ? "1" + b64url(packed) : "0" + b64url(raw);
}

/**
 * Where get.txt lives, derived from wherever the page is being served. The
 * standalone build has no directory to sit in, so it carries an override, and
 * a page opened straight off disk gets a placeholder rather than a file:// URL
 * that curl could never fetch.
 */
export function installerUrl() {
  if (globalThis.__BASELAYER_INSTALLER) return globalThis.__BASELAYER_INSTALLER;
  const { origin, pathname, protocol } = window.location;
  if (protocol === "file:") return "https://YOUR-SITE.neocities.org/get.txt";
  const dir = pathname.replace(/[^/]*$/, "");
  return `${origin}${dir}get.txt`;
}

export function curlCommand(payload, { url = null, dir = null } = {}) {
  const target = url || installerUrl();
  const out = dir ? ` -o ${dir}` : "";
  return `curl -sL ${target} | sh -s --${out} ${payload}`;
}

/** Rough guide to whether a shell will accept the command. */
export const ARG_LIMIT = 120000;

// --- downloads ---------------------------------------------------------------

export function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(name, text) {
  downloadBlob(name, new Blob([text], { type: "text/plain;charset=utf-8" }));
}

// --- minimal ZIP writer (stored, no compression) -----------------------------
// A handful of small text files does not need deflate, and this keeps the site
// dependency-free.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

  // DOS timestamp: fixed, so the same config always produces the same archive.
  const dosTime = 0;
  const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
    ];
    chunks.push(new Uint8Array(local), nameBytes, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  }

  const dirStart = offset;
  for (const e of central) {
    const rec = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(dosTime), ...u16(dosDate),
      ...u32(e.crc), ...u32(e.size), ...u32(e.size),
      ...u16(e.nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(e.offset),
    ];
    chunks.push(new Uint8Array(rec), e.nameBytes);
    offset += rec.length + e.nameBytes.length;
  }

  const end = [
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(offset - dirStart), ...u32(dirStart), ...u16(0),
  ];
  chunks.push(new Uint8Array(end));

  return new Blob(chunks, { type: "application/zip" });
}

// --- clipboard ---------------------------------------------------------------

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to the old trick.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

// --- optional: publish to a paste host --------------------------------------
// The pure-static curl command above needs no third party. This is for when you
// want a genuinely short URL that `curl -O` can fetch on its own. Both hosts
// below accept a simple cross-origin POST, and both expire.

export const PASTE_HOSTS = [
  {
    id: "dpaste",
    name: "dpaste.org",
    note: "Text paste host. Expires after a week unless you say otherwise.",
    async upload(text) {
      const body = new URLSearchParams({
        content: text,
        lexer: "nix",
        format: "url",
        expires: "604800",
      });
      const res = await fetch("https://dpaste.org/api/", { method: "POST", body });
      if (!res.ok) throw new Error(`dpaste returned ${res.status}`);
      const url = (await res.text()).trim().replace(/^"|"$/g, "");
      return { url, raw: `${url.replace(/\/$/, "")}/raw` };
    },
  },
  {
    id: "tmpfiles",
    name: "tmpfiles.org",
    note: "File host. Keeps the upload for one hour.",
    async upload(text) {
      const form = new FormData();
      form.append("file", new Blob([text], { type: "text/plain" }), "configuration.nix");
      const res = await fetch("https://tmpfiles.org/api/v1/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error(`tmpfiles returned ${res.status}`);
      const json = await res.json();
      const url = json?.data?.url;
      if (!url) throw new Error("tmpfiles did not return a URL");
      return { url, raw: url.replace("tmpfiles.org/", "tmpfiles.org/dl/") };
    },
  },
];
