# Codenotch for Ubuntu

An Ubuntu GNOME adaptation of [vinzdg/codenotch](https://github.com/vinzdg/codenotch), based on upstream commit `743601acd69e701131602b88082fcaeee0c2e88b`.

The notch reproduces upstream's black silhouette, inverse curved corners, 44-unit usage rings, traced provider logos, colors, proportional spacing, percentage labels, and usage cards. **Your requested addition is included:** a settings gear occupies its own cell, separated from the AI cells by `|` in a horizontal notch (a horizontal rule in a vertical notch).

The gear opens a menu with **Show in notch**, **Verify connection**, connection status, credential source, last successful reading, and usage windows for each AI. An additional settings window controls appearance, monitor, and demo mode.

## Requirements

- **Ubuntu Desktop 24.04 with GNOME Shell 46 is the primary target.** The package also declares GNOME 47–50 compatibility; those versions require desktop validation.
- GNOME Wayland or GNOME Xorg session. KDE, XFCE, Cinnamon, and Ubuntu 22.04 / GNOME 42 are not supported by this build.
- A signed-in local installation of any AI tool you want to monitor.
- Internet access for official usage endpoints; Antigravity reads its local language server.
- No Node, npm, pip, Electron, or Docker installation is needed to run the `.deb`.

Check your desktop:

```bash
gnome-shell --version
echo "$XDG_CURRENT_DESKTOP / $XDG_SESSION_TYPE"
```

## Install the included `.deb`

Extract the ZIP and open a terminal inside the extracted `codenotch-ubuntu` directory:

```bash
sudo apt update
sudo apt install ./dist/codenotch_0.1.0_all.deb
```

**Log out of Ubuntu and log back in once.** This lets GNOME discover the newly installed system extension. On Wayland, restarting an application or terminal does not replace this step.

Then enable it as your regular desktop user, without `sudo`:

```bash
gnome-extensions enable codenotch@ubuntu.local
```

A small black pill appears on the **right edge** of your primary display. Hover over it to unfold the notch. If no signed-in tools are found, the gear remains available so you can inspect the connections.

Open settings from the gear, the top-panel menu, or the application launcher entry **Codenotch Settings**:

```bash
codenotch settings
```

Once enabled, GNOME restores the extension at login. The package does not modify your global enabled-extension list, install a root daemon, or restart your desktop during installation.

## Configure AIs and verify them

1. Hover over the notch and click the **gear after the divider**.
2. Expand an AI's submenu.
3. Set **Show in notch** to enable or disable it. Enabled, detected tools appear automatically; undetected tools remain listed in settings with sign-in guidance.
4. Click **Verify connection**. This checks the saved local login and requests usage from the owning provider. Read the connection result and **Last success** in that submenu. `Verify all enabled connections` checks every enabled AI.
5. Hover over an AI ring for its allowance windows, reset times, and available session activity.

**Verification is real, not simulated:** a connection is marked connected only after its adapter receives and parses usage. In demo mode the UI explicitly says `Demo`; sample readings never count as live verification. A disabled provider must be enabled before verification.

Turning an AI off stops its credential reads, clears its cached readings, and removes its ring. It does not sign you out of the owning application. Turning it back on discovers that application's current saved login.

| AI | Linux usage source | Setup / important behavior |
| --- | --- | --- |
| Claude Code | `~/.claude/.credentials.json` → Anthropic OAuth usage endpoint | Run `claude` and sign in. Additional `~/.claude-<name>` profiles get separate rings and switches. `CLAUDE_CONFIG_DIR` is also honored when inherited by the worker. |
| Codex | `~/.codex/auth.json` → ChatGPT usage endpoint | Run `codex login` with your ChatGPT account. An API-key-only login does not expose a ChatGPT allowance. `CODEX_HOME` is honored when inherited. |
| Cursor | `~/.config/Cursor/User/globalStorage/state.vscdb` → Cursor usage summary | Sign in inside Cursor. SQLite is opened read-only with WAL support. Custom, Snap, or Flatpak profile paths are not automatically mapped. |
| Antigravity | Current user's running Antigravity language server → local quota RPC | Start Antigravity and sign in. If the local server exposes no readable quota, the UI reports unavailable; this port does not fabricate a percentage or fall back to Google's cloud endpoint. |
| GLM | Z.ai Coding Plan key in Claude Code settings, OpenCode auth, or recognized ZCode configuration | Configure a Z.ai or BigModel Coding Plan in one of those tools. The key is sent only to its matching Z.ai/BigModel monitor endpoint. |
| Grok | `~/.grok/auth.json` → Grok CLI billing credits | Run `grok login`. Only xAI-issued sessions are accepted; private/custom identity-provider tokens are excluded. |
| OpenCode | `~/.local/share/opencode/auth.json`, `opencode-go` entry → OpenCode Go usage | Sign in to the Go plan in OpenCode. Other OpenCode model providers are separate services and do not represent a Go allowance. |

`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME` are respected. Environment variables set only in an interactive terminal are not necessarily inherited by GNOME Shell.

The usage readings come from the endpoints used by upstream; many are internal provider APIs. Their formats can change. If a request fails, the last successful usage remains visibly stale with its date in settings. Missing values show a dash, never an invented 0%.

## Appearance

In **Appearance and more settings…** choose:

- **On hover**, **Always show**, or **Hidden**.
- **Right**, **Left**, **Top**, or **Bottom** edge.
- Primary display or a numbered display, with automatic fallback after a monitor disconnects.
- 75%, 100%, 125%, 150%, or 200% size; long stacks scale down to fit.
- Top-panel icon and fullscreen hiding.
- Demo mode, which reads no provider credentials and makes no network calls.

The notch uses GNOME's available work area, respecting panels and dock-reserved space. Auto-hiding dock behavior follows the work area advertised by your dock extension. It hides in Activities and on the lock screen. GNOME's reduced-motion setting disables the expansion animation.

The upstream macOS settings orb has intentionally been replaced by your requested inline gear and divider. Settings use native GNOME controls. Ubuntu's system sans-serif font substitutes for Apple's SF Pro, so font rasterization is not pixel-identical to macOS. macOS hardware-notch integration and Sparkle automatic updates are not part of this Linux port.

## Demo / commands

```bash
# Enable sample data to inspect the notch before signing in
codenotch demo true

# Return to live data
codenotch demo false

# Verify one provider, or every enabled provider
codenotch verify claude
codenotch verify codex
codenotch verify all

# Inspect cached status (does not contact providers)
codenotch status

# Disable / re-enable the extension
codenotch disable
codenotch enable
```

CLI output is JSON containing usage and status, never tokens. Per-profile Claude IDs appear in `codenotch status` (for example `claude:.claude-work`).

## Polling and privacy

- The extension invokes a separate Python worker asynchronously. Network calls do not run on GNOME Shell's UI thread.
- Local activity is checked every 2 seconds when the worker is idle. Usage is polled every 60 seconds while sessions are active, otherwise every 5 minutes.
- Provider jobs run concurrently, with per-request timeouts. A slow request can delay the next local activity scan until that worker finishes.
- HTTP 429 triggers persisted exponential backoff, starting at 60 seconds. Longer `Retry-After` values are honored. Manual verification cannot bypass an active rate-limit deadline.
- Credentials are read from the owning tools and used in memory. Codenotch does not save, rotate, refresh, or log tokens. Redirects are rejected to prevent forwarding borrowed credentials.
- Remote TLS certificates are verified. The local Antigravity bridge is the only self-signed exception: it is restricted to `127.0.0.1` and ports discovered from a same-user Antigravity process.
- Settings and non-secret cached readings are stored in `~/.config/codenotch/` and `~/.cache/codenotch/`, with private file permissions.
- Claude session state is read from its session registry. Cursor state is read from composer headers. Codex and Grok activity is explicitly described as inferred from recent local writes. Session activity is not implemented for GLM, OpenCode, or Antigravity in this version.

## Build from source

The ZIP includes everything needed to rebuild the `.deb`; no GitHub checkout is required.

```bash
sudo apt install python3 dpkg-dev
./scripts/build-deb.sh
```

The output is `dist/codenotch_0.1.0_all.deb`. `Architecture: all` means the source-based package works with both amd64 and arm64 Ubuntu, provided its GNOME dependencies are satisfied.

Run the automated checks (Node is only needed for the JavaScript checks):

```bash
PYTHONPATH=backend python3 -m unittest discover -s tests -v
node tests/test-layout.mjs
node --check extension/extension.js
node --check extension/prefs.js
```

Or run `make deb` if Python 3, Node, Make, and `dpkg-deb` are installed.

Optional shared-renderer preview harness:

```bash
npm install --no-save sharp
node scripts/render-preview.cjs
```

This creates `docs/preview.png` through the same drawing functions as the extension, with an SVG adapter. It is a rendering check, not a full GNOME Shell integration test.

## Troubleshooting

**“Extension does not exist” after installation**

Log out and back in, then run:

```bash
gnome-extensions list
gnome-extensions enable codenotch@ubuntu.local
```

**“Unsupported” / dependency errors**

Check `gnome-shell --version`. This package targets GNOME 46–50. Do not disable GNOME's extension version validation to force it onto a different major version.

**No notch**

```bash
gnome-extensions info codenotch@ubuntu.local
codenotch settings
```

Set visibility to `Always show` and monitor to `Primary display`. Leave fullscreen and Activities. Enable the global Extensions switch in the Extensions application if it is off.

**A connection fails**

Open the owning AI tool and verify that it is signed in. Run its own usage screen, then retry from the notch. Expired tokens are refreshed by the owning tool, not by Codenotch. Wait for provider backoff after a 429. Antigravity must be running. Check the source path in the AI's settings row for custom-profile differences.

**Inspect extension errors**

```bash
journalctl --user -b -o cat | grep -i codenotch
```

The diagnostics JSON may contain local project names in session rows; review it before sharing.

## Upgrade or uninstall

Install a newer `.deb` with the same `sudo apt install ./...deb` command. Log out and back in to reload extension code.

```bash
codenotch disable
sudo apt remove codenotch
```

Your local settings/cache are retained. To explicitly erase only Codenotch's data after disabling it:

```bash
rm -rf ~/.config/codenotch ~/.cache/codenotch
```

If you use custom XDG directories, use their corresponding `codenotch` subdirectories instead. No owning AI tool's credentials are removed.

## Validation and limitations

See [`docs/PORTING.md`](docs/PORTING.md) and [`docs/TEST-REPORT.md`](docs/TEST-REPORT.md). This deliverable has automated provider/state tests, JavaScript syntax and geometry checks, package extraction checks, and shared-renderer visual verification. **It has not been run in a complete Ubuntu GNOME desktop session or verified against your live AI accounts.** The `.deb` is an initial port for desktop validation, not a claim of fully tested platform parity.

## License

MIT. Original artwork, geometry, and source-derived behavior © 2026 Vinz. The original [`LICENSE`](LICENSE) is retained. This Ubuntu port is not an official upstream release.
