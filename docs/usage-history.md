# Usage history

Settings → Usage shows token and cost statistics, daily/hourly charts, model and
agent breakdowns, and an annual contribution calendar across local LLM records.
Enable **Data → Read local usage records** to scan. Refresh reads only appended/changed
records; normal notch polling never scans transcripts for token totals. Turning the
feature off stops scans and hides the report; it leaves the private ledger on disk.

Automatic sources:

- Claude Code `projects/**/*.jsonl` for enabled Claude profiles. Repeated streaming
  records for one message are merged, not summed. Input and cached input are separate.
- Codex `sessions/**/*.jsonl` and `archived_sessions/**/*.jsonl` for enabled profiles.
  Running totals are differenced; cached input is subtracted from input before summing.
- OpenCode `opencode.db` messages, opened read-only with its WAL visible. Only completed
  assistant messages are included. Reasoning is included in output.
- Versioned JSONL imports for any other client or provider, described below.

Missing days mean **no recorded data**, not measured zero. The grid counts tokens,
not requests or subscription quota percentages: unrelated allowance percentages
cannot meaningfully be summed. Dates use the machine's local timezone. A record is
assigned to the time its client reported, which is not necessarily request start.

`codenotch usage` performs the same bounded incremental scan and returns JSON. If
`more` is true, call it again to continue. Preferences continues automatically while
the Usage tab is visible. Each pass reads at most 16 MiB for roughly two seconds,
with a 1 MiB per-record bound. The first scan of a large history may need several
passes. Subsequent refreshes reuse file offsets and unchanged-file metadata.

The ledger is `~/.cache/codenotch/history.sqlite`, owner-readable only. It stores token
counts, timestamps, model names and project paths; it does not store messages or
credentials. Deleting it rebuilds from original records on the next enabled scan.

## Other LLM clients

Write UTF-8 JSONL under `$XDG_DATA_HOME/codenotch/usage-imports/` (default
`~/.local/share/codenotch/usage-imports/`). Each complete newline-terminated record:

```json
{"schemaVersion":1,"id":"unique-message-id","source":"kimi","model":"kimi-model-id","timestamp":"2026-09-28T12:00:00Z","project":"example","tokens":{"input":100,"output":20,"cacheRead":50,"cacheWrite":0}}
```

Counters are **disjoint**, non-negative integers: `input` excludes cache read/write.
`input` and `output` are required; cache counters default to zero. Use a stable source
and ID to avoid duplicate imports. An amended record can increase the same message's
counters. Imported data never executes a program. A provider's quota snapshot alone
cannot populate token history; it must publish token records or an export.

## Estimated API costs

Configure exact model IDs under **Usage → Data → Model prices**, use the JSON price
import field, or:

```bash
codenotch set modelPrices '{"example-model":{"input":1,"output":4,"cacheRead":0.1,"cacheWrite":1.25}}'
```

These are USD per million tokens, supplied by you. All four categories are required,
including explicitly free categories. Unknown models remain unpriced. Totals with
unpriced tokens are labelled incomplete. Estimates are not subscription charges or
provider invoices; CodeNotch does not download a pricing catalog.

## Analytics dashboard

The Usage page has five tabs and shared **Period**, **Agent**, and **Model** filters.
Choose the last 7, 30, 90, or 365 days. The displayed date interval is limited to the
available history configured in Data. **Clear filters** restores all agents/models;
**Refresh** incrementally scans local records without requesting provider quotas.

- **Overview:** two spacious summary cards, the Git-style annual contribution grid,
  daily charts, and expandable activity/token details. Includes total tokens, usage-record count, estimated API cost and pricing
  coverage, active days, average tokens per active day, cache-read share, daily token
  or estimated-cost bars, activity streaks, busiest day, peak hour, token composition,
  hourly activity, and leading models. Click a daily bar for that day's details.
- **History:** a paginated daily table with input/output/cache counters and estimated
  costs, newest/oldest sorting, selected-day model totals, and monthly summaries.
  The Overview calendar uses the full available year with the agent/model filters,
  independently of the period selector. Selecting a day opens its History details.
  Narrow windows can scroll the table and calendar horizontally.
- **Models / Agents:** token-share bars, totals and estimates. Select a row to filter
  the Overview. Agents also shows the latest enabled-account quota windows and reset
  times, separately from token history. Verify connections on the Connections page.
- **Data:** history opt-in, available report period, per-model price editors for all
  four token categories, JSON price import, and explanations of coverage and metrics.

Charts support arrow-key inspection, exact-value tooltips and Enter to open day
details. Daily table cells show exact token counts on hover. An unpriced amount is
never presented as a zero-dollar charge; partial estimates are marked explicitly.

An **active day** contains at least one token. The **current streak** ends today or
yesterday; the longest streak is within the selected period. Missing days break
streaks. The average uses active days, and cache-read share uses total disjoint
input/output/cache tokens as its denominator. Hourly charts use local recorded event
timestamps. Counts describe usage records, not API requests or sessions.

Agent breakdowns group client sources (Claude Code, Codex, OpenCode, or import source),
not individual accounts. Accounts of the same client contribute to the same agent.
The report contains aggregated day/source/model buckets and hourly token totals;
project paths and transcript contents are not sent to preferences.

The layout takes inspiration from the supplied [Pulse token-spend references](https://github.com/qunqin24/Pulse/blob/main/Docs/spend.webp),
using native GNOME controls and Codenotch's local ledger and explicitly configured prices.

When no selected records have prices, **Daily estimated cost** explains why no cost
chart is available and offers **Set model prices**. Configure the four rates for
models under Data; then save and refresh. Zero rates mean explicitly free tokens.
Small positive estimates retain sub-cent precision instead of appearing as $0.00.

Settings follow the system light/dark preference by default. Override it under
**Appearance → Settings appearance → Color scheme**. Cards use native theme colors.


Overview uses one shared content width for navigation, summaries, chart cards and the
calendar. It opens with four summary tiles (tokens, estimated cost, active days, tokens
per active day), then daily activity or cost, the daily token mix (fresh input, output,
cache read, cache write), cumulative recorded tokens, tokens by weekday beside tokens by
hour, and top models beside agents. The contribution grid follows all charts. The
cumulative line sums only recorded tokens; missing records are not interpreted as
measured zero usage. Weekday totals follow local calendar dates and all active filters.
Cards are separated by 24px and their contents by 12px on every settings page. Smaller
screens can still scroll the calendar and tables horizontally.

Each Claude Code, Codex and OpenCode account page repeats a compact summary of the same
records: today, the last 30 days, the busiest day, all history, and the top model.
Records are grouped by tool, so several profiles of one tool share these figures.
