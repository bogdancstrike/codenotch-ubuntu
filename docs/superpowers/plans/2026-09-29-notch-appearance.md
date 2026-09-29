# Notch Appearance Implementation Plan

> Execute the three tasks inline, verifying and committing/pushing each task separately as requested.

**Goal:** Make top-bar usage visibility easy to configure, keep bulk connection verification in settings, and open settings wide enough for Usage.

**Architecture:** Reuse the persisted `panelUsage` and `panelIcon` settings and existing live settings updates. Adjust native GNOME preferences and menus without changing provider polling.

**Tech Stack:** GJS, GTK 4, libadwaita, Python settings worker.

### Task 1: Top-bar visibility

- [x] In `extension/prefs.js`, add a `Top bar` preferences group in Appearance. Move existing panel controls there, labeling the switches `Show icon in top bar` and `Show usage in top bar`, with a `Claude 25% used` example and instructions for hiding the entire indicator.
- [x] In `extension/extension.js`, include `panelUsage:true` in startup defaults and initialize the panel label with `visible:!!this._settings.panelUsage`.
- [x] Document the switches in `README.md`. Run `make check` and `make test`; inspect the diff. Commit and push task 1.

### Task 2: Bulk verification in settings

- [x] In `extension/extension.js`, remove the notch's `Verify all enabled connections` item and the panel's `Refresh now` item, both of which invoke `--verify all`.
- [x] Point the worker-read error message at Connections settings. Preserve the settings page's `Verify all` button and individual verification controls.
- [x] Document the location in `README.md`. Run `make check` and inspect all bulk verification references. Commit and push task 2.

### Task 3: Wider settings

- [ ] Set the preferences window default width to 1100 in `extension/prefs.js`, retaining height 860 and window resizing.
- [ ] Inspect the Usage page's native content clamp and ensure the full annual calendar fits. Match the smoke test's width to the preferences default in `scripts/test-usage-view.js`.
- [ ] Run `make check` and the native Usage smoke test. Inspect the rendered preview for clipping. Commit and push task 3.
