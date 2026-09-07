# Architecture

<p align="center">
  <img src="architecture.svg" alt="Codenotch architecture: GNOME Shell draws, a short-lived Python worker reads and requests" width="100%">
</p>

Codenotch is two programs with one rule between them: **GNOME Shell draws, and never
waits.** Everything that can block — reading a credential file, opening SQLite, talking
to a provider, asking a weather service — happens in a short-lived Python worker that the
shell launches asynchronously and reads back as a single JSON snapshot.

---

## The pieces

| File | Runs in | Responsibility |
| --- | --- | --- |
| `extension/extension.js` | GNOME Shell | Chrome actors, spring animation, hover and hit testing, popup menu, lifecycle |
| `extension/render.js` | GNOME Shell + harnesses | All geometry and drawing: silhouette, rings, widgets, dividers, gear, cards |
| `extension/glyphs.js` | GNOME Shell | Upstream provider marks as normalised polygons |
| `extension/prefs.js` | Preferences process | libadwaita pages; every change is written by the worker |
| `backend/codenotch/worker.py` | Worker | Settings, locking, snapshot assembly, poll cadence |
| `backend/codenotch/providers.py` | Worker | Credential discovery and the seven usage adapters |
| `backend/codenotch/model.py` | Worker | Payload parsers. Missing data stays missing |
| `backend/codenotch/activity.py` | Worker | Which AI sessions are running right now |
| `backend/codenotch/widgets.py` | Worker | Weather, battery, and `/proc` + `statvfs` load |

`render.js` has no GNOME imports. That is deliberate: the same module draws the README
images through `scripts/render-shell-preview.js` (real Pango, real cairo) and through the
SVG adapter in `scripts/render-preview.cjs`, so a picture in the docs cannot drift from
what the shell paints.

---

## Drawing

The notch is one `St.DrawingArea`. `render.js` lays it out as a list of **cells**:

```
[flare] pad  ring ring ring  │  clock  date  weather  │  gear  pad [flare]
        └── providers ──┘        └──── widgets ────┘     └ settings ┘
```

`plan(providers, widgets, edge, folded)` returns each cell's `start`, `extent` and
`center` along the notch, the divider positions between groups, and the gear's centre.
Everything else — hit testing, the hover card anchor, the settings button's position — is
derived from that one function, so adding a widget cannot desynchronise the click targets
from the pixels.

`point(g, edge, along, across)` maps the two notch axes onto screen coordinates, which is
why all four screen edges share one drawing path.

**Text** goes through a pluggable engine. GNOME installs a Pango engine (real hinting,
real metrics, letter spacing); the SVG harness falls back to cairo's toy text API.

---

## Motion

Opening and closing are integrated as a **spring**, not a fixed curve:

```js
[value, velocity] = spring(value, velocity, target, dt, stiffness, damping)
```

Because position *and* velocity carry across frames, an interrupted gesture continues from
where it was rather than restarting — hover in, out, and back in during the animation and
the notch never jumps. Opening uses a slightly softer spring than closing, so the notch
arrives with a hint of settle but leaves the screen edge decisively. Content is revealed
after the shell is mostly open and staggered per cell.

`St.Settings.get().enable_animations` is respected: with animations off, the notch snaps.

### Why the actors follow the drawing

The class of bug that makes a desktop feel *stuck* is an invisible reactive actor sitting
over a screen edge. Three rules prevent it:

1. **Folded means small.** At rest the drawing area is only as large as the sliver — a
   sliver-sized actor cannot swallow a desktop click.
2. **Reactive only when open.** `_syncChrome()` sets `reactive`, the gear button's
   visibility, and the hover strip from `progress`, never from intent. A half-open notch
   is not clickable, and neither is a notch that has been hidden.
3. **A pointer guard.** Once a second, if the pointer is demonstrably elsewhere and no
   menu is open, anything left open is folded. Stale hover state cannot outlive it.

Hover itself lives on a separate slim `_hotspot` strip over the sliver, so the drawing
area never needs to be reactive while it is folded.

The popup menu is closed before it is ever rebuilt or destroyed. A live popup grab that
outlives its actor is the other way a session loses its clicks.

---

## The worker and its two locks

A worker run is: read settings → maybe mutate them → discover providers → poll what is due
→ write the cache → print JSON. The locking is the interesting part.

| Lock | Held for | Blocking? |
| --- | --- | --- |
| `settings.lock` | A settings read or an atomic write | Yes — but only for microseconds, never across a request |
| `poll.lock` | One polling cycle, including HTTP | **No** — a second worker declines and answers from cache |

This is what keeps the preferences window responsive. Changing a setting takes the short
lock, writes, and returns; it never queues behind a provider that is 15 seconds into a
timeout. A snapshot that arrives while another cycle is running returns the cached
snapshot with `"busy": true` instead of piling up parallel requests.

### Settings that cannot be written one key at a time

`configuration()` validates and clamps on every read, and some settings are only
meaningful together. The weather location is the case that bites: latitude without
longitude is not a place, so a half-set pair is discarded. Writing the two keys with
separate `--set` calls could therefore never complete a location — the second write read
back the nulls the first one left. `--location` takes the name and both coordinates and
writes them in one transaction; `--set` refuses those three keys outright.

### Poll cadence

| What | When | Default |
| --- | --- | --- |
| Provider usage | A local session of that AI is running | every 150 s (`pollSeconds`) |
| Provider usage | Nothing running | every 600 s (`idlePollSeconds`) |
| Weather | Always | every 900 s |
| Clock and date | Drawn from the local clock | no worker involvement at all |
| Local activity scan | Shell asks the worker | 6 s busy · 15 s open · 30 s folded · 120 s hidden |

A worker run with nothing due costs about **15 ms of CPU and 16 MB of RSS**, because the
expensive imports are on the paths that need them: `urllib`/`ssl`/`email` only when a
request is made, `sqlite3` only for Cursor and Codex, `dataclasses` and `tempfile` not at
all. `local_state()` runs serially and decides what is due; a thread pool is created only
when something will actually go over the network. At the folded cadence that is 0.05% of
one core.

The shell's scan interval and the provider request interval are separate on purpose: the
"working" ring should react in seconds, while a provider should be asked a couple of times
a minute at most. `nextPoll` and `retryAt` live in the cache, so a restart does not reset
backoff, and HTTP 429 with `Retry-After` is always honoured.

---

## Credentials

Every credential is read from the tool that owns it, used in memory for one request, and
never written, refreshed, logged, or included in the snapshot. A disabled provider is
never even *looked at* — the enablement check happens before detection.

Antigravity is the one provider with a discovery chain, because it has two clients:

1. A running language server (IDE) on `127.0.0.1`, discovered only from
   same-uid processes and their own sockets.
2. The `agy` CLI, queried non-interactively for its structured JSON quota
   (`agy -p /quota --output-format json`), allowing full allowance reporting without
   requiring an IDE running.
3. Otherwise the `agy` CLI's Google login, held in the session keyring. Ordinary polling
   only checks that the item *exists*; the secret is retrieved only when a usage request
   is actually going to be made.

If Google declines to publish the allowance to a third-party client and no CLI is available,
that is reported as "signed in, no allowance published" — not as a missing sign-in, and
never as a fabricated percentage.

---

## Extending it

**A new widget** needs an entry in `WIDGET_EXTENT`, a branch in `drawWidget`, a case in
`widgetCard` for its hover card, a row in `prefs.js`, and — only if it needs data the shell
cannot compute — a collector in `widgets.py`. Prefer the shell: the clock costs nothing
because it never leaves the shell.

If a collector caches, it must read and write the *same* key. `widgets.collect()` stores
each reading back into the cache dict it was handed, because `weather()` and
`needs_network()` both look for `cache['weather']` — an earlier version wrote it one level
deeper, so nothing was ever cached and every poll became a fresh request.

**A new provider** needs a `Provider` entry in `discover()`, a branch in `Provider.fetch`,
a parser in `model.py`, and a glyph. The parser must raise rather than invent a number.

**Trying a change** is `codenotch --update` from anywhere inside the checkout: it
syntax-checks, compiles, builds the `.deb`, installs it, and says whether the session
needs a restart. The worker and preferences pick up changes immediately; on Wayland the
extension's own code waits for a new session, which is a GNOME constraint, not ours.
