# Pulse-inspired Ubuntu improvements

**Goal:** Implement the recommended quota-monitoring improvements, push each tested feature, and install the resulting Ubuntu package.

**Architecture:** Keep network, file scanning and subprocesses in the short-lived Python worker. Share pure presentation logic between the Cairo renderer, GNOME panel and Node checks. Persist optional feature state privately; disabled features do no background work.

**Tech stack:** Python standard library, GJS/Cairo/Pango, GTK4/libadwaita, Debian packaging.

## Commit sequence and acceptance checks

- [x] Quota selection: `extension/usage.js`, renderer, preferences, worker settings. Auto selects the highest fraction; stable per-account pins fall back when missing. Node tests cover empty/malformed windows and independent account pins.
- [x] Notifications: `backend/codenotch/alerts.py`, worker, shell, preferences. Persist threshold/reset/outage transitions; only fresh readings can trigger quota events; acknowledgement prevents replay. Tests cover oscillation, restart and stale data.
- [x] Cache expiry: `backend/codenotch/cache.py`, worker, renderer. Discard expired windows and readings older than 24 hours in both polling and cached status. Preserve retry deadlines. Tests cover partial expiry, offline reads and unknown timestamps.
- [x] Activity: `backend/codenotch/activity.py` and tests. Read bounded Codex transcript tails for lifecycle events with a timeout for abandoned turns; support current state database discovery. Never expose transcript contents.
- [ ] Presentation: used/remaining setting, critical/exhausted colors, optional window clock. Keep ring geometry and percentage semantics consistent. Retain only provider-reported durations. Node and parser tests.
- [ ] Panel dashboard: selected/automatic account summary and per-account windows in the GNOME panel. Cache-only menu updates and disabled-account filtering. Test pure selection/formatting.
- [ ] Diagnostics: allowlisted CLI report and preferences copy action, latest-check vs last-good distinction, bounded fallback attempt records. Verify reports exclude paths, labels, sessions and credentials.
- [ ] Forecast: pure optional forecast from reported duration, fraction and reset; suppress early, expired and stale estimates. Test expected exhaustion and no-duration cases.
- [ ] Accounts: multiple Codex/Grok profiles and configurable labels; credential paths remain owned by tools. Tests cover discovery, custom paths and disabled accounts.
- [ ] Providers: opt-in Copilot and Kimi adapters using existing local credentials, defensive parsers and fixture tests. Document required login sources and live-validation limits.
- [ ] Custom providers: bounded opt-in executables under XDG data, versioned manifest/output, minimal environment, process-group timeout, output cap. Tests execute harmless fixture scripts and validate rejection cases.
- [ ] History: opt-in incremental local Claude/Codex token ledger with private SQLite cache, date/model/project summaries and explicitly configured model prices. Usage tab with an aggregate daily contribution grid, day selection and model breakdown, plus CLI report; tests cover cumulative counters, deduplication, cache reuse and unknown prices.
- [ ] Integration/optimization/install: run `make test check`, GJS rendering/preferences smoke checks, benchmark idle and cached history paths, build versioned package, install via documented updater, verify installed files and live shell. Push the final integration commit.

For every feature: implement the focused checks, run `make test check`, update this checklist and README, commit with a descriptive message, then `git push origin HEAD`. Keep live provider checks separate from fixture validation. Installation must preserve user settings. Never restart the entire X11 session without warning; use GNOME's supported reload if available.
