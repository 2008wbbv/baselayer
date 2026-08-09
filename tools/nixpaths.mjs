// Pulls declared NixOS option paths out of emitted Nix source.
//
// Only leaf assignments count: `services.foo = { enable = true; }` declares
// `services.foo.enable`, not `services.foo`, because the index only carries
// leaves. Anything nested under a freeform option is user data and is skipped.

export const FREEFORM = new Set([
  "settings", "config", "environment", "serverProperties", "extraConfig",
  "exports", "rules", "scrapeConfigs", "sysctl", "loginLimits",
  "sessionVariables", "shellAliases", "extraOptions", "virtualHosts",
  "timerConfig", "defaultNetwork", "serverProperties",
]);

/** A dotted key like `settings.server` is freeform if any segment is. */
export const isFreeformKey = (key) =>
  key.split(".").some((s) => FREEFORM.has(s) || s.startsWith('"'));

/** Namespaces that are real NixOS module options. */
export const NAMESPACES =
  /^(services|programs|security|networking|boot|hardware|virtualisation|system|nix|users|environment|fonts|i18n|time|xdg|zramSwap|powerManagement|console|systemd|documentation|swapDevices|home-manager|musnix)\b/;

/** Values we generate that the index cannot describe, or that are not options. */
export const SKIP =
  /^(nixpkgs\.config|imports|environment\.systemPackages|fonts\.packages|swapDevices|home-manager|musnix)/;

export function extractPaths(lines) {
  const stack = [];
  const out = [];
  let freeformAt = null;

  const emitLeaf = (key) => {
    if (freeformAt !== null || isFreeformKey(key)) return;
    out.push([...stack, key].join("."));
  };

  const push = (key, isList) => {
    stack.push(isList ? `${key}.*` : key);
    if (freeformAt === null && isFreeformKey(key)) freeformAt = stack.length - 1;
  };

  let inString = false;
  for (const raw of lines) {
    const line = raw.trim();
    const quotes = (raw.match(/''/g) || []).length;
    if (inString) {
      if (quotes % 2 === 1) inString = false;
      continue;
    }
    if (quotes % 2 === 1) { inString = true; continue; }
    if (!line || line.startsWith("#")) continue;

    if (/^[}\]);]+$/.test(line)) {
      if (freeformAt !== null && stack.length - 1 === freeformAt) freeformAt = null;
      stack.pop();
      continue;
    }

    // single-line attrset:  key = { a = 1; b = 2; };
    let m = line.match(/^([\w.'"-]+)\s*=\s*\{(.+)\};?\s*$/);
    if (m && !m[2].includes("{")) {
      const parent = m[1];
      if (!isFreeformKey(parent))
        for (const part of m[2].split(";")) {
          const im = part.trim().match(/^([\w.'"-]+)\s*=/);
          if (im) emitLeaf(`${parent}.${im[1]}`);
        }
      continue;
    }

    // block open:  key = {   |   key = [{   |   key = [
    m = line.match(/^([\w.'"-]+)\s*=\s*(\[\{|\{|\[)\s*$/);
    if (m) { push(m[1], m[2].startsWith("[")); continue; }

    // leaf:  key = value;
    m = line.match(/^([\w.'"-]+)\s*=\s*[^{[]/);
    if (m) { emitLeaf(m[1]); continue; }
  }
  return out;
}

/** Turn index names containing <name> or * into a matcher. */
export function buildMatcher(names) {
  const exact = new Set();
  const patterns = [];
  for (const n of names) {
    if (/[<*]/.test(n)) {
      patterns.push(new RegExp("^" + n.split(".").map((seg) =>
        /^<.*>$/.test(seg) || seg === "*"
          ? "[^.]+"
          : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ).join("\\.") + "$"));
    } else exact.add(n);
  }
  return (path) => exact.has(path) || patterns.some((r) => r.test(path));
}
