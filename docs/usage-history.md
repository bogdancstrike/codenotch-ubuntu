# Usage history

Settings → Usage shows a GitHub-style daily token grid across supported local LLM
records, a selectable day breakdown, and per-model input/output/cache counters.
Enable **Read local usage records** to scan. Refresh reads only appended/changed
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

Configure exact model IDs in Usage's model-prices field, or:

```bash
codenotch set modelPrices '{"example-model":{"input":1,"output":4,"cacheRead":0.1,"cacheWrite":1.25}}'
```

These are USD per million tokens, supplied by you. All four categories are required,
including explicitly free categories. Unknown models remain unpriced. Totals with
unpriced tokens are labelled incomplete. Estimates are not subscription charges or
provider invoices; CodeNotch does not download a pricing catalog.
