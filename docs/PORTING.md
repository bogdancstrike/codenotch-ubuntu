# Porting notes

## Architecture

See [`architecture.md`](architecture.md) and [`architecture.svg`](architecture.svg) for the
full picture. In brief:

`extension/extension.js` owns the GNOME chrome, monitor/work-area placement, spring animation, input targets, popup menu, and cleanup lifecycle. GNOME Shell supplies Wayland/Xorg compositing; there is no always-on-top window workaround or unsupported Wayland window positioning.

`extension/render.js` is a UI-toolkit-independent Cairo-style drawing module. It contains the original proportional geometry and palette, and renders the notch, ring cells, widget cells, dividers, gear, and hover cards. Text goes through a pluggable engine: GNOME installs a Pango engine, and the preview harnesses fall back to cairo's toy text API. `glyphs.js` is a mechanical conversion of upstream's normalized polygons, not an image recreation. `scripts/extract-glyphs.py` can regenerate it from an upstream checkout.

`extension/prefs.js` supplies native libadwaita settings across three pages. Both settings surfaces write through the same worker.

`backend/codenotch/worker.py` runs outside Shell, discovers providers, checks enablement before reading credentials, polls concurrently, retains stale readings, persists backoff, and emits non-secret JSON. `providers.py` maps Linux credential locations to upstream endpoints. `model.py` contains isolated payload parsers; `activity.py` reads supported local session sources; `widgets.py` gathers weather, battery, and `/proc` load.

Locking changed in 0.2.0. Settings reads and writes take a short `settings.lock` that is never held across a request. Polling takes a separate `poll.lock` acquired **non-blocking**: a second worker declines and answers from cache. A slow provider can no longer make a settings change or the preferences window wait behind it.

The installed worker is `/usr/lib/codenotch/codenotch-worker`. The GNOME extension is `/usr/share/gnome-shell/extensions/codenotch@ubuntu.local/`. The launcher is `/usr/bin/codenotch`. The package does not register a privileged service.

## Design fidelity

Source baseline: [vinzdg/codenotch, commit 743601a](https://github.com/vinzdg/codenotch/tree/743601acd69e701131602b88082fcaeee0c2e88b).

- Scale anchor: `44 / 117` from upstream `Design.swift`.
- Side depth: `186 * scale`; inverse flare radius: `103 * scale`; corner radius: `78.8 * scale`.
- Ring: 44 units, original thick track / thin progress stroke, same provider polygons.
- Colors: black, `#303030` ring track, `#2D2D2D` bar track, `#00FF88` green, `#F2FF00` yellow, `#FF3F00` orange.
- Thresholds: 50% turns yellow; 70% turns orange.
- Tooltips: `600 * scale` width, original padding/corner/tail proportions.
- Settings is an added inline cell plus divider, as requested, replacing upstream's external orb.

Platform differences are explicit: system sans-serif typography, native GNOME preferences/menu controls, no Apple hardware-notch behavior, no macOS presence APIs or Sparkle. Animation follows the same fold/expand idea but is implemented with GNOME timers and a spring integrator that carries position and velocity across frames, so an interrupted hover continues rather than restarting. It is not a binary SwiftUI port.

Additions beyond upstream, all optional and off by default except the clock and date: notch widgets (clock, date, weather, battery, system load) with their own hover cards, a visible resting sliver, a text-contrast setting, and configurable poll cadence.

## Provider scope

All seven providers in the current upstream README have adapters. Claude, Codex, Cursor, GLM, Grok, and OpenCode use upstream's usage endpoint shapes and Linux-local credentials.

Antigravity has two clients on Linux and both are recognised: the IDE and the `agy` CLI. Detection prefers a running language server on `127.0.0.1` (same-uid processes only, ports read from their own sockets), then the `agy` CLI's structured JSON quota (`agy -p /quota`) which allows full allowance reading without an IDE running, then the CLI's Google login held in the session keyring. When Google declines to publish the allowance to a third-party client and no CLI is available, that is surfaced as "signed in, no allowance published" rather than a missing sign-in. Upstream's transcript-count fallback is still not ported. Unsupported or absent quota is reported as unavailable, never as a percentage.

Claude profile discovery only accepts `~/.claude-*` directories that hold a credential file, `settings.json`, `sessions/`, or `statsig/`. Unrelated tools that squat on that prefix (`~/.claude-flow`, for example) no longer appear as permanently unauthenticated rings.

Claude multi-profile handling, persisted backoff, no invented percentages, disabled-provider credential isolation, and read-only SQLite/WAL behavior are included. Cursor/Grok activity uses Linux process checks; heuristic activity is identified. GLM, OpenCode, and Antigravity activity is not implemented.

No web server, telemetry endpoint, token vault, external service, or subscription is introduced.

## Reference material

- Upstream design frames are retained in `docs/design/` under its MIT license.
- [GNOME extension structure and lifecycle](https://gjs.guide/extensions/overview/anatomy.html).
- [GNOME Shell 46 source](https://github.com/GNOME/gnome-shell/tree/gnome-46), checked for popup menu and layout APIs.
- [GJS Cairo bindings](https://github.com/GNOME/gjs/blob/master/modules/cairo-context.cpp), checked for drawing/text methods.

## Desktop acceptance checklist

On a target Ubuntu desktop, install the `.deb`, log out/in, and enable the extension. Verify:

1. Extension reports `ENABLED` with no JS error in the journal.
2. All four edge layouts unfold from a pill; settings gear/divider remain accessible.
3. Each AI toggle persists, removes its ring, and clears the cached reading.
4. Each enabled provider reports a real verification result using local credentials.
5. Hover cards remain on-screen at 100%/200% display scaling and with multiple monitors.
6. Monitor disconnects, dock work-area changes, Activities, fullscreen, lock/unlock, and extension disable/re-enable behave correctly.
7. Uninstall leaves other tools and their credentials intact.

These desktop checks could not be performed in the headless build environment and must not be presented as passed.
