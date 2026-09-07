# Validation report — 0.2.0

## Automated checks

- 43 Python unit/integration tests: payloads for all seven providers, correct zero vs missing usage, real window durations, secondary quota exclusion, GLM error envelopes, remaining-quota inversion, over-limit values, multi-profile ordering, disabled-provider isolation, persisted backoff and Retry-After, private writes, read-only SQLite WAL visibility, redirect refusal, loopback-only TLS exception, trusted Grok issuers, GLM key audience, demo isolation, persisted disconnection, and absence of tokens from successful output. 0.2.0 adds: new-setting validation and clamping, idle cadence never faster than the active one, the non-blocking poll lock declining instead of queueing, a busy snapshot answering from cache without polling, Claude profile discovery rejecting unrelated `~/.claude-*` directories, Antigravity CLI detection, weather cache hit/miss/offline behaviour, device batteries excluded from the battery widget, CPU needing two samples before reporting, and widget collection only gathering what is enabled.
- JavaScript geometry assertions: all four edges, zero through twelve providers, every widget combination, non-overlapping cells, in-bounds cell/gear coordinates, the gear centred in its own cell, resting-sliver size limits, gear and cell hit targets, color thresholds, reset countdowns, session caps, local clock/date formatting, a hover card for every widget kind, spring convergence in both directions, and contrast tiers.
- Node syntax checks for extension, preferences, and renderer.
- Python bytecode compilation.
- `.deb` creation with `dpkg-deb --root-owner-group`, control/archive inspection, extraction, and execution of the extracted worker in demo mode.
- The drawing module rendered twice: through the SVG adapter (`scripts/render-preview.cjs`, no GNOME needed) and — new in 0.2.0 — through **the exact runtime path GNOME uses**, `scripts/render-shell-preview.js`, which loads `render.js` under gjs with the real Pango text engine and cairo, and writes `docs/preview*.png`. That second pass exercises every drawing call, the Pango engine, and the widget/card code as the shell would, so a runtime API error in the renderer fails the image build.

## Not verified here

- Full GNOME Shell startup, interactive menu, preferences, lifecycle, monitor/DPI behavior, hover and spring feel, or the pointer guard in a live session. The drawing and text path is exercised under gjs, but the extension's actor and animation code has not been run inside a live Shell in this environment.
- Authentication or live usage requests against the user's accounts. No user credentials were provided or requested.
- GNOME 47–50 runtime compatibility or an arm64 desktop; metadata and architecture-independent packaging are not runtime test results.
- Browser-based rendering: the Chromium download timed out. The completed visual check uses the shared renderer through SVG instead.

The acceptance checklist in `PORTING.md` is still required on the destination desktop. This is an initial Ubuntu port and must not be described as a fully verified 1:1 macOS replacement.
