# Settings UX and widgets

Continue inline with the existing UI/UX and testing skills. Preserve all pending user changes, including the modified Debian package.

- Add six opt-in widgets: CPU, memory, storage, network throughput, uptime, CPU temperature. Share system samples and never collect disabled widgets. Use unavailable states for missing sensors and first network/CPU samples.
- Add compact notch rendering and informative hover cards on all four edges. Keep automatic fit for large selections.
- Group widget switches into daily essentials and system monitors; show enabled count and conditional clock/weather configuration. Separate notification settings from polling.
- Refine Usage with two-column cards, generous spacing, collapsible secondary analysis, explicit filter reset and context, better empty states and focus preservation when switching chart metrics. Keep history detail easy to reach.
- Run backend, geometry, analytics, GJS load, and renderer checks as permitted. Commit/push each task if Git access returns. The current sandbox denies `.git` writes and desktop display access.

Implemented: six widgets, grouped/conditional settings, theme choice, quieter Usage cards, expandable secondary metrics, activity grid on Overview, explicit missing-price action and sub-cent cost formatting. Offline Cairo widget preview succeeds. Native GTK visual verification and commits remain blocked by environment restrictions. The pre-existing modified .deb was preserved.
