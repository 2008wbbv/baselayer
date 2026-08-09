// Original glyph set, drawn as plain geometry on a 24x24 grid.
//
// These are deliberately category marks rather than reproductions of project
// logos: a project's logo is usually trademarked, and shipping copies of a few
// hundred of them would be both legally awkward and a large download. Identity
// comes from the brand colour plus the category glyph, which stays legible at
// 20px and never 404s. A catalog entry can set `iconUrl` if you would rather
// supply the real artwork yourself.

export const GLYPHS = {
  browser: "M3 6.5h18M3 6.5v11a1.5 1.5 0 0 0 1.5 1.5h15a1.5 1.5 0 0 0 1.5-1.5v-11a1.5 1.5 0 0 0-1.5-1.5h-15A1.5 1.5 0 0 0 3 6.5ZM5.5 4.9v.1M8 4.9v.1M10.5 4.9v.1",
  editor: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h4",
  terminal: "M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5zM7 9l3 3-3 3M13 15h4",
  code: "M9 7l-5 5 5 5M15 7l5 5-5 5",
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  media: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM10 9l5 3-5 3z",
  video: "M3 7.5A1.5 1.5 0 0 1 4.5 6h9A1.5 1.5 0 0 1 15 7.5v9A1.5 1.5 0 0 1 13.5 18h-9A1.5 1.5 0 0 1 3 16.5zM15 10.5l6-3.5v10l-6-3.5z",
  music: "M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
  image: "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM3 15l5-4 4 3 3-2 6 4M8.5 9.5v.01",
  palette: "M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.3-1.1-1.6-1.1-2.7 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7ZM7.5 10.5v.01M11 7.5v.01M15.5 8.5v.01",
  controller: "M7 9h10a4 4 0 0 1 4 4v2.5a2.5 2.5 0 0 1-4.6 1.4L15 15H9l-1.4 1.9A2.5 2.5 0 0 1 3 15.5V13a4 4 0 0 1 4-4ZM7 11.5v3M5.5 13h3M16 12.5v.01M18 14.5v.01",
  chat: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z",
  shield: "M12 3l7.5 3v5.5c0 4.4-3 7.9-7.5 9.5-4.5-1.6-7.5-5.1-7.5-9.5V6z",
  key: "M15 3a6 6 0 1 0-4.2 10.2L9 15H7v2H5v2H3v-3l7.8-7.8A6 6 0 0 0 15 3ZM16 7.5v.01",
  lock: "M6 10.5A1.5 1.5 0 0 1 7.5 9h9a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 16.5 20h-9A1.5 1.5 0 0 1 6 18.5zM8.5 9V6.5a3.5 3.5 0 0 1 7 0V9M12 13.5v3",
  network: "M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM5 15a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM19 15a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM12 9v3M12 12H6.5a1.5 1.5 0 0 0-1.5 1.5V15M12 12h5.5a1.5 1.5 0 0 1 1.5 1.5V15",
  database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  cloud: "M7 19a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17.2 9.6 4 4 0 0 1 17 19z",
  disk: "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM12 11.8v.01",
  cpu: "M8 8h8v8H8zM6 5.5A1.5 1.5 0 0 1 7.5 4h9A1.5 1.5 0 0 1 18 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18.5zM3 8.5h3M3 12h3M3 15.5h3M18 8.5h3M18 12h3M18 15.5h3",
  cog: "M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM12 2.5l1.4 2.3 2.6-.6.4 2.7 2.5 1-1.3 2.4 1.7 2.1-2.2 1.6.4 2.7-2.7.2-1 2.5-2.3-1.4-2.3 1.4-1-2.5-2.7-.2.4-2.7L3 12.4l1.7-2.1L3.4 7.9l2.5-1 .4-2.7 2.6.6z",
  doc: "M6 3.5A.5.5 0 0 1 6.5 3H14l4 4v13.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5zM14 3v4h4M9 12h6M9 15.5h6M9 8.5h2",
  font: "M5 20l5.5-15h3L19 20M8 14.5h8",
  flask: "M9 3h6M10 3v6.5L4.6 18.4A1.5 1.5 0 0 0 5.9 20.7h12.2a1.5 1.5 0 0 0 1.3-2.3L14 9.5V3M7.2 14.5h9.6",
  book: "M12 6.5C10.5 5 8 4.2 4 4.5v13c4-.3 6.5.5 8 2 1.5-1.5 4-2.3 8-2v-13c-4-.3-6.5.5-8 2ZM12 6.5v13",
  mail: "M3 7A1.5 1.5 0 0 1 4.5 5.5h15A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17zM3.5 6.5l8.5 6 8.5-6",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2.5 2.5h8A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z",
  chart: "M4 20V4M4 20h16M8 16.5V11M12.5 16.5V7M17 16.5v-4",
  robot: "M8 9h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM12 6V9M12 4.2v.01M9.5 13v.01M14.5 13v.01M9.5 16h5M3.5 12.5v3M20.5 12.5v3",
  vpn: "M12 3a9 9 0 0 1 8.5 6M12 3a9 9 0 0 0 0 18M12 3c2.2 2.3 3.3 5.2 3.3 7M12 3C9.8 5.3 8.7 8.2 8.7 10M3.5 10.5h11M4.5 15.5h5M16 14.5A1.5 1.5 0 0 1 17.5 13h4a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5zM17.8 13v-1.6a1.7 1.7 0 0 1 3.4 0V13",
  tv: "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5zM8 20h8M12 17v3",
  mic: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6",
  desktop: "M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5zM8 20.5h8M12 17v3.5",
  tiling: "M3.5 4.5h7v15h-7zM13.5 4.5h7v6.5h-7zM13.5 13.5h7v6h-7z",
  server: "M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v3A1.5 1.5 0 0 1 19.5 10h-15A1.5 1.5 0 0 1 3 8.5zM3 15.5A1.5 1.5 0 0 1 4.5 14h15a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5zM6.5 7v.01M6.5 17v.01",
  home: "M4 11.5L12 4l8 7.5M6.5 10v9.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V10M10 20.5v-6h4v6",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM16.2 16.2L21 21",
  download: "M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5M4 17v2.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V17",
  package: "M12 3l8 4v10l-8 4-8-4V7zM4.3 7.2L12 11l7.7-3.8M8 5l8 4M12 11v10",
  camera: "M3 8.5A1.5 1.5 0 0 1 4.5 7h2.8l1.5-2.5h6.4L16.7 7h2.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM12 9.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z",
  printer: "M7 9V4h10v5M7 18H5.5A1.5 1.5 0 0 1 4 16.5v-5A1.5 1.5 0 0 1 5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17M7 14h10v6.5H7zM6.8 12.5v.01",
  wrench: "M15.5 3a6 6 0 0 0-5.2 9L3 19.3 5.7 22l7.3-7.3A6 6 0 0 0 21 8.4l-3.2 3.2-2.6-.7-.7-2.6L17.7 5A6 6 0 0 0 15.5 3Z",
  phone: "M7 3.5A1.5 1.5 0 0 1 8.5 2h7A1.5 1.5 0 0 1 17 3.5v17a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20.5zM10.5 19h3",
  flame: "M12 3c.5 3 3 4 3 7a3 3 0 0 1-6 0c0-1 .5-1.8 1-2.5M6.5 13.5a5.5 5.5 0 1 0 11 0c0-2.5-1.5-4-2.5-5",
};

export const FALLBACK_GLYPH = "package";

/** An inline SVG string for a glyph. */
export function svg(name, { size = 20, stroke = "currentColor", width = 1.7 } = {}) {
  const d = GLYPHS[name] || GLYPHS[FALLBACK_GLYPH];
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true"
    stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

/** Convert #rrggbb to an rgba() string. */
export function tint(hex, alpha) {
  const h = (hex || "#888888").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Relative luminance, used to keep brand colours legible on both themes. */
export function luminance(hex) {
  const h = (hex || "#888888").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

// Real project marks, loaded from data/logos.json at startup. Empty until then,
// so every call falls back to a category glyph and nothing waits on the fetch.
let LOGOS = {};

export function setLogos(icons) {
  LOGOS = icons || {};
}

export const hasLogo = (id) => Object.hasOwn(LOGOS, id);

/**
 * The tile used everywhere an item is shown.
 *
 * A real logo is used when one exists for the entry. simple-icons marks are a
 * single monochrome path, so they are drawn in the project's own brand colour
 * on a tint of it; dashboard-icons marks carry their own colours and sit on a
 * neutral tile instead, which is the only way multi-colour art stays legible in
 * both themes. Anything with no logo keeps its category glyph.
 */
export function logoTile(item, { size = 38, glyph = null } = {}) {
  const logo = LOGOS[item.icon === false ? null : item.id];
  const inner = Math.round(size * (logo?.src === "dashboard-icons" ? 0.62 : 0.58));
  const box = `width:${size}px;height:${size}px`;

  if (logo?.mono) {
    const brand = logo.hex || item.brand || "#7a8699";
    const lum = luminance(brand);
    // Near-black and near-white brand colours vanish against one theme or the
    // other, so those fall back to the text colour.
    const ink = lum < 0.09 || lum > 0.9 ? "currentColor" : brand;
    return `<span class="tile" style="--brand:${brand};--tile-ink:${ink};${box}">
      <svg viewBox="0 0 24 24" width="${inner}" height="${inner}" aria-hidden="true"
        fill="var(--tile-ink)"><path d="${logo.mono}"/></svg></span>`;
  }

  if (logo?.svg) {
    return `<span class="tile art" style="${box}">
      <svg viewBox="${logo.viewBox}" width="${inner}" height="${inner}" aria-hidden="true"
        >${logo.svg}</svg></span>`;
  }

  const brand = item.brand || "#7a8699";
  const name = glyph || item.glyph || FALLBACK_GLYPH;
  const lum = luminance(brand);
  const ink = lum < 0.12 || lum > 0.88 ? "currentColor" : brand;
  if (item.iconUrl)
    return `<span class="tile" style="--brand:${brand};${box}">
      <img src="${item.iconUrl}" alt="" width="${inner}" height="${inner}" loading="lazy"></span>`;
  return `<span class="tile" style="--brand:${brand};--tile-ink:${ink};${box}">${
    svg(name, { size: inner, stroke: "var(--tile-ink)", width: 1.7 })
  }</span>`;
}
