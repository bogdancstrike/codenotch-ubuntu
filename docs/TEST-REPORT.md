# Validation report — 0.1.0

## Automated checks

- 28 Python unit/integration tests: payloads for all seven providers, correct zero vs missing usage, real window durations, secondary quota exclusion, GLM error envelopes, remaining-quota inversion, over-limit values, multi-profile ordering, disabled-provider isolation, persisted backoff and Retry-After, private writes, read-only SQLite WAL visibility, redirect refusal, loopback-only TLS exception, trusted Grok issuers, GLM key audience, demo isolation, persisted disconnection, and absence of tokens from successful output.
- JavaScript geometry assertions: all four edges, zero through twelve providers, in-bounds cell/gear coordinates, gear hit targets, original ring anchor, color thresholds, reset countdowns, and session caps.
- Node syntax checks for extension, preferences, and renderer.
- Python bytecode compilation.
- `.deb` creation with `dpkg-deb --root-owner-group`, control/archive inspection, extraction, and execution of the extracted worker in demo mode.
- Shared drawing module rendered through an SVG adapter and inspected as `docs/preview.png`. It shows all four notch placements, original marks/colors, the requested settings divider, tooltip content, and resting pill. Text measurement in this development adapter is approximate; GNOME uses Cairo's real text extents.

## Not verified here

- Full GNOME Shell startup, interactive menu, preferences, lifecycle, monitor/DPI behavior, or desktop installation. No GNOME desktop/session is available in this build environment.
- Authentication or live usage requests against the user's accounts. No user credentials were provided or requested.
- GNOME 47–50 runtime compatibility or an arm64 desktop; metadata and architecture-independent packaging are not runtime test results.
- Browser-based rendering: the Chromium download timed out. The completed visual check uses the shared renderer through SVG instead.

The acceptance checklist in `PORTING.md` is still required on the destination desktop. This is an initial Ubuntu port and must not be described as a fully verified 1:1 macOS replacement.
