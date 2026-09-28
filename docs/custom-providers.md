# Custom quota programs

Create `$XDG_DATA_HOME/codenotch/extensions/acme/` (default
`~/.local/share/codenotch/extensions/acme/`) containing `codenotch-extension.json`:

```json
{"schemaVersion":1,"id":"acme","name":"Acme quota","executable":"run","timeoutSeconds":20}
```

`run` must be executable and remain inside that folder, including after resolving
symlinks. It prints one JSON object, then exits zero:

```json
{"schemaVersion":1,"limits":[{"id":"monthly","label":"Monthly requests","used":25,"limit":100,"resetsAt":"2026-10-01T00:00:00Z"}]}
```

Alternatively use `usedPercent`. `windowSeconds` is optional and must be the actual
reported duration. Incomplete counters are omitted. This schema reports quotas,
not money balances. A failure can return `status` of `needsAuth`, `offline`,
`rateLimited`, or `unavailable`; arbitrary program messages are never displayed.

Reopen Connections and enable the new account. Nothing executes before enablement.
Programs own their authentication. CodeNotch passes no credentials and gives them
only home/user/locale/XDG variables, a fixed PATH, and CODENOTCH_EXTENSION_ID/SCHEMA.
There is no stdin, stderr is discarded, stdout is capped at 256 KiB, and the entire
process group is stopped after the configured timeout (1–30 seconds). Programs run
as your user; this is process isolation and resource bounding, not a security sandbox.
