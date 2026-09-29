# Usage Dashboard Implementation Plan

**Goal:** Expand native Usage preferences using the supplied Pulse screenshots as visual references for summary metrics, trends, history, agent/model drilldowns, and settings.

**Architecture:** Extend the private ledger report with daily source/model buckets and hourly totals; no schema migration or extra network requests. Pure JavaScript derives filtered analytics. Native GTK widgets provide navigation, charts, tables, and configuration.

**Tech Stack:** Python sqlite3/unittest; GJS GTK 4/libadwaita/Cairo; Node assertions.

## Implementation

- [x] Extend `backend/codenotch/history.py` summary with `breakdown` buckets keyed by day/source/model, disjoint token counters, cost coverage, and hourly token totals. Test reconciliation, excluded sources, range bounds, missing prices, and zero rates in `tests/test_history.py`.
- [x] Extend `extension/history-model.js` with filtered report aggregation for 7/30/90/365 days; daily/monthly totals, model/agent shares, hourly activity, streaks, cache share, and cost coverage. Add `tests/test-history-model.mjs` for mixed-source/model filters, sparse days, dates, and incomplete costs; include it in `make test`.
- [x] Create `extension/history-widgets.js` for reusable native metric cards, accessible bar charts, breakdown rows, and paginated history table. Charts show units, scale, endpoint dates and per-bar tooltips; tables provide exact values.
- [x] Update `extension/history-view.js` with Overview / History / Models / Agents / Data tabs, period and source/model filters, overview cards, daily and hourly charts, year calendar, model/agent drilldown, current provider quotas, and opt-in/pricing controls. Reuse the existing async scan lifecycle. Feed current provider snapshots from `extension/prefs.js`.
- [ ] Extend the native smoke script to cover tab navigation, filters, history pagination, chart rendering, calendar day selection, disabled/empty/partial states and screenshots. Run syntax checks, Python and Node tests, then GTK checks if the environment permits GUI access.
- [ ] Document the dashboard and interpretation of metrics in `docs/usage-history.md` and `README.md`. Review the diff, commit task 4, and push as requested if filesystem/network permissions permit.

## Validation and remaining environment limits

- Syntax, Python ledger tests, Node layout and analytics tests pass. Analytics date tests also pass in America/New_York and Europe/Bucharest.
- GJS loads the new modules and confirms the installed GTK/libadwaita APIs without a display.
- The native smoke script now covers tabs, filters, drilldowns, pagination, calendar selection, native prices, and disabled/empty/partial states, but cannot execute here: the restricted sandbox denies desktop display access and temporary display socket binding. Visual verification remains outstanding.
- Documentation is updated. Commit and push are blocked because the updated environment mounts `.git` read-only. No attempt was made to bypass that restriction.
- Additional user-requested Codex fix is implemented and regression-tested: automatic headline selection prefers the main five-hour window, preserving explicit pins and all hover-card windows. Its separate commit/push is also blocked by the same restriction.
