# baselayer

A NixOS configuration builder that runs entirely in the browser. Pick what the
machine is for, a desktop, packages, self-hosted services and how locked down
you want it, and get real `flake.nix` / `configuration.nix` files you can
download, share as a link, or pull straight onto the box with `curl`.

There is no backend. The whole thing is static files, which is the point: it
works on the cheapest possible hosting, and nothing you configure is ever
uploaded anywhere.

## What it does

- **Prebuilt bundles** - thirteen starting points (media server, homelab, gaming
  rig, Hyprland rice, **Suckless/dwm**, NAS, smart-home hub, privacy workstation,
  local AI box…). Applying one just ticks boxes; everything stays editable.
- **Desktops** - 20 desktop environments and window managers, each with the
  right display manager, portals and session tools wired up. That includes
  **dwm**, with an overlay that builds dwm, st, dmenu and dwmblocks from your
  own patched fork, since suckless tools take their configuration at compile
  time and cannot be configured through options at all.
- **Packages** - a curated catalog of ~180 with descriptions, brand colours and
  documentation links, plus **live search across all of nixpkgs** using the same
  index `search.nixos.org` queries. Searched packages carry their real licence,
  version and homepage into the review screen.
- **Self-hosted services** - 59 services generated from their actual NixOS
  modules, with ports collected into the firewall, dependencies pulled in
  automatically, an optional Caddy or nginx reverse proxy with automatic HTTPS,
  and an explicit list of the secret files you must create by hand.
- **Security levels** - Relaxed, Baseline, Hardened and Paranoid, built from 23
  independent toggles you can override individually. Every switch states what it
  costs you, because a machine you cannot use is not a win.
- **Flake inputs** - 14 community repositories (Home Manager, sops-nix, disko,
  Lanzaboote, Stylix, nixos-hardware…) pinned into `flake.nix`.
- **Conflict checking** - hardened kernel against the NVIDIA driver, port
  collisions, two services fighting over port 80, Vaultwarden without HTTPS,
  ACME on a `.local` domain, and so on.
- **A review screen** - counts by category, licence breakdown, the open ports,
  where each service will answer, a logo wall, and a documentation link for
  every single thing you selected.

## Getting the config onto the machine

Four ways, in rough order of convenience:

1. **Download** - a `.zip` of every generated file, or each file individually.
2. **Share link** - the entire configuration is compressed into the URL
   fragment. Nothing is stored server-side; the link *is* the config.
3. **curl one-liner** - described below.
4. **Upload to a paste host** - optional, off by default, and it hands your
   config to a third party. Only worth it if you specifically want a short URL.

### The curl one-liner

Static hosting cannot generate a different response per visitor, so there is no
honest way to serve `https://site/my-config.nix`. Instead the payload travels
*inside the command*: the host serves one fixed script, and your configuration
is the compressed argument after it.

```sh
curl -sL https://YOUR-SITE.neocities.org/get.txt | sh -s -- <PAYLOAD>
```

`get.txt` is a short, readable POSIX shell script. It does not touch the
network, does not need root, and only writes files into a directory you name:

```sh
# straight into the installer's target
curl -sL https://YOUR-SITE.neocities.org/get.txt | sh -s -- -o /mnt/etc/nixos <PAYLOAD>

# or read the payload from stdin instead of argv
curl -sL https://YOUR-SITE.neocities.org/get.txt | sh -s -- - <<'EOF'
<PAYLOAD>
EOF
```

It refuses to overwrite existing files unless you pass `-f`, and rejects any
filename that is not a plain name in the target directory.

## Deploying to Neocities

Upload the repository contents as-is. There is no build step, no bundler and no
dependencies.

```
index.html
get.txt
assets/style.css
src/*.js
data/*.json
```

Two things worth knowing about Neocities specifically:

- The installer is `get.txt`, not `get.sh`, because the free tier only serves an
  allow-list of extensions and `.sh` is not on it. `.txt`, `.json`, `.js`,
  `.css` and `.html` all are, which is everything this site needs.
- The site must be served over HTTP(S), not opened as a `file://` path, because
  the catalog is fetched as JSON and browsers block that from the filesystem.
  For a genuinely offline copy, use the standalone build below.

The same files work unchanged on GitHub Pages, Codeberg Pages, Netlify, a plain
nginx root, or `python3 -m http.server`.

## Running it locally

```sh
python3 -m http.server 8137     # then open http://localhost:8137/
```

## Standalone single file

```sh
node tools/bundle.mjs baselayer-standalone.html
```

Inlines every module, the stylesheet, the logos and the whole catalog into one
~580 kB HTML
file that works from `file://`, a USB stick, or an offline laptop. Live nixpkgs
search naturally does not work without a network; it falls back to the bundled
catalog and says so.

## Layout

```
index.html            page shell
assets/style.css      all styling, light and dark
src/state.js          state shape, bundle presets, URL encoding
src/generate.js       the generator: state -> Nix files
src/validate.js       conflict and consistency checks
src/nixsearch.js      live nixpkgs / NixOS options search
src/share.js          zip writer, curl payload, clipboard, paste hosts
src/icons.js          the glyph set and logo tiles
src/ui.js             views
src/app.js            wiring
data/*.json           the catalog - packages, services, desktops, security,
                      hardware, flake inputs, bundles
data/logos.json       generated project marks (see Logos below)
get.txt               the installer script the curl command pipes into
tools/                tests and utilities
```

The catalog is plain JSON with no code in it, so adding a package or a service
is a data edit. A service entry looks like this:

```json
{
  "id": "jellyfin", "name": "Jellyfin", "cat": "media",
  "brand": "#00a4dc", "glyph": "tv",
  "desc": "Media server for films, TV and music.",
  "home": "https://jellyfin.org/", "docs": "https://jellyfin.org/docs/",
  "opt": "services.jellyfin", "web": true, "webPort": 8096,
  "ports": { "tcp": [8096], "udp": [1900, 7359] },
  "nix": ["services.jellyfin = {", "  enable = true;", "};"]
}
```

`%%USER%%`, `%%HOSTNAME%%`, `%%DOMAIN%%`, `%%TIMEZONE%%` and `%%HOSTID%%` are
substituted at generation time. Use `nixByChannel` when an option name differs
between releases.

## Correctness

Nix refuses to define the same attribute twice in one attribute set, which is
the easiest way for a generator like this to emit something that does not
evaluate. Every block records the option paths it owns, and a block that would
collide is dropped rather than silently producing a broken file. Features that
legitimately share a list-valued option (`boot.blacklistedKernelModules`, the
firewall port lists, `environment.systemPackages`) contribute to it instead and
the generator merges them.

### Tests

```sh
node tools/test.mjs              # ~1500 structural checks, offline
node tools/test.mjs --online     # also verify every emitted option exists
node tools/verify-catalog.mjs    # check the catalog against the live index
node tools/browser-check.mjs     # drive the real page in Chromium
node tools/fetch-logos.mjs       # regenerate data/logos.json
```

`tools/test.mjs` generates configurations across every bundle, desktop, display
manager, GPU, filesystem, firmware, security level, service and channel, then
asserts the output has balanced brackets, no duplicate attribute paths, no
leftover template placeholders and no dropped blocks.

`--online` and `verify-catalog.mjs` check every NixOS option path and package
attribute the project can emit against the real `search.nixos.org` index, for
**all three channels** (25.11, 26.05, unstable). This is worth running before
release: options genuinely move between releases. It is how this project found
that GNOME had moved to `services.desktopManager.gnome`, that `programs.river`
became `programs.river-classic`, that `services.resolved.dnssec` became
`services.resolved.settings.Resolve.DNSSEC` after 25.11, that the Deepin and
Jellyseerr modules were removed, and that `services.displayManager.gdm.wayland`
no longer exists.

`tools/browser-check.mjs` needs Chromium and covers 37 behaviours end to end,
including decoding the generated curl payload back into the exact same files and
a full share-link round trip.

## Logos

Real project marks, bundled locally so the page makes no external requests:

- **[simple-icons](https://simpleicons.org/)** (CC0-1.0) - monochrome 24x24 paths
  plus each project's official brand colour. Used for 158 entries.
- **[homarr-labs/dashboard-icons](https://github.com/homarr-labs/dashboard-icons)**
  (Apache-2.0) - full-colour marks, and the only practical source for
  self-hosted service logos. Used for 29 entries.

The marks themselves are trademarks of their owners and appear here only to
identify the software, which is the same basis both upstream projects ship them
on. Anything with no logo in either set - most CLI tools genuinely have none -
falls back to a hand-drawn category glyph, so nothing ever renders empty.

Regenerate with:

```sh
npm install simple-icons@16
node tools/fetch-logos.mjs --refresh --report
```

The tool matches on id, attribute and name, caches what it resolved, and skips
any mark over 20 kB (a couple upstream are enormously detailed - one is 89 kB by
itself, which costs more than the logo is worth). Pin a specific icon with
`"icon": "<slug>"` on a catalog entry, or opt out with `"icon": false`.

## Appearance

Light by default. The theme button in the header cycles light, dark, and
following your system setting; the choice is remembered.

## Things it deliberately does not do

- **It does not write `hardware-configuration.nix`.** That file describes your
  actual disks and UUIDs. Keep the one `nixos-generate-config` produced.
- **It does not put secrets in the config.** Services that need a password or
  key get a listed file path and a command to create it, or you can add sops-nix
  or agenix and manage them properly.
- **It does not estimate download sizes.** Closure size depends on your channel
  and cache state, and a made-up number would be worse than no number.
- **It does not validate against a real Nix evaluator.** Option *names* are
  checked against the live index, but only `nixos-rebuild` can tell you the
  whole thing type-checks. Read the config before you apply it.
