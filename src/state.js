// Application state: one plain object, serialised into the URL hash so a
// configuration can be shared as a link.

export const STATE_VERSION = 1;

/** Release used for system.stateVersion when the channel is unstable. */
export const LATEST_RELEASE = "26.05";

export const CHANNELS = [
  { id: "26.05", name: "NixOS 26.05", desc: "Current stable release. The right default.", release: "26.05" },
  { id: "25.11", name: "NixOS 25.11", desc: "Previous stable. Still supported for a while.", release: "25.11" },
  { id: "unstable", name: "nixos-unstable", desc: "Rolling. Newest packages, occasional breakage.", release: LATEST_RELEASE },
];

export const SYSTEMS = [
  { id: "x86_64-linux", name: "x86_64", desc: "Ordinary 64-bit PC hardware." },
  { id: "aarch64-linux", name: "aarch64", desc: "ARM64 - Raspberry Pi 4/5, Ampere, Asahi." },
];

export function defaultState() {
  return {
    v: STATE_VERSION,
    meta: {
      hostname: "nixos",
      username: "user",
      fullName: "",
      timezone: "Etc/UTC",
      locale: "en_US.UTF-8",
      keymap: "us",
      channel: "26.05",
      format: "flake",
      system: "x86_64-linux",
    },
    profile: "desktop",
    firmware: "uefi",
    filesystem: "ext4",
    swap: "zram",
    gpu: "intel",
    cpu: "intel",
    desktop: "gnome",
    loginManager: "auto",
    packages: [],
    // Packages added through live nixpkgs search, carrying the metadata the
    // index gave us so the review screen can be honest about licences.
    extra: [],
    services: [],
    flakes: [],
    security: "baseline",
    // Explicit per-toggle overrides on top of the level preset: id -> bool.
    toggles: {},
    net: { ssh: false, networkManager: true, extraTCP: [], extraUDP: [] },
    proxy: { enabled: false, engine: "caddy", baseDomain: "example.com", email: "" },
    opts: {
      flatpak: false,
      bluetooth: false,
      gaming: false,
      hwAccel: false,
      autoLogin: false,
      printing: false,
      appimage: false,
      docs: true,
      optimise: true,
    },
    bundle: null,
  };
}

/** Deep-ish clone that is enough for this shape. */
export const clone = (o) => JSON.parse(JSON.stringify(o));

/** Merge a bundle patch into a fresh default state. */
export function applyBundle(bundle, base) {
  const s = clone(base || defaultState());
  const p = bundle.patch;
  if (p.profile) s.profile = p.profile;
  if (p.desktop !== undefined) s.desktop = p.desktop;
  if (p.gpu) s.gpu = p.gpu;
  if (p.filesystem) s.filesystem = p.filesystem;
  if (p.swap) s.swap = p.swap;
  if (p.security) s.security = p.security;
  if (p.loginManager) s.loginManager = p.loginManager;
  if (p.packages) s.packages = [...new Set(p.packages)];
  if (p.services) s.services = [...new Set(p.services)];
  if (p.flakes) s.flakes = [...new Set(p.flakes)];

  const o = p.options || {};
  if (o.ssh !== undefined) s.net.ssh = o.ssh;
  if (o.reverseProxy !== undefined) s.proxy.enabled = o.reverseProxy;
  for (const k of ["flatpak", "bluetooth", "gaming", "hwAccel", "autoLogin", "printing", "appimage"])
    if (o[k] !== undefined) s.opts[k] = o[k];

  s.bundle = bundle.id;
  s.toggles = {};
  return s;
}

/** Toggles that are actually on: level preset, then explicit overrides. */
export function activeToggles(state, security) {
  const level = security.levels.find((l) => l.id === state.security) || security.levels[0];
  const on = new Set(level.toggles);
  for (const [id, val] of Object.entries(state.toggles || {})) {
    if (val) on.add(id);
    else on.delete(id);
  }
  return on;
}

// --- URL hash serialisation --------------------------------------------------
// The state is small, so it is stored as compact JSON, deflate-compressed when
// the browser supports it, then base64url encoded.

const b64urlEncode = (bytes) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlDecode = (str) => {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function deflate(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  const cs = new CompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeState(state) {
  const json = new TextEncoder().encode(JSON.stringify(state));
  const packed = await deflate(json);
  return packed && packed.length < json.length
    ? "1" + b64urlEncode(packed)
    : "0" + b64urlEncode(json);
}

export async function decodeState(str) {
  if (!str) return null;
  const mode = str[0];
  const body = b64urlDecode(str.slice(1));
  const json = mode === "1" ? await inflate(body) : body;
  const parsed = JSON.parse(new TextDecoder().decode(json));
  if (parsed.v !== STATE_VERSION) throw new Error("This link was made with a different version of the site.");
  // Fill in anything a shorter link left out.
  return { ...defaultState(), ...parsed, meta: { ...defaultState().meta, ...parsed.meta } };
}
