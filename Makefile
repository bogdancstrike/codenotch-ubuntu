.PHONY: test gtk-test deb check preview clean

test:
	PYTHONPATH=backend python3 -m unittest discover -s tests -v
	node tests/test-layout.mjs
	node tests/test-history-model.mjs

# Needs a display: drives the real GTK widgets.
gtk-test:
	gjs -m scripts/test-usage-view.js
	gjs -m scripts/test-settings-shell.js

check:
	python3 -m compileall -q backend
	node --check extension/extension.js
	node --check extension/prefs.js
	node --check extension/render.js
	node --check extension/usage.js
	node --check extension/history-view.js
	node --check extension/history-model.js
	node --check extension/history-widgets.js
	node --check extension/preferences-style.js
	node --check extension/settings-shell.js

# Redraws docs/preview*.png through the extension's own renderer. The gjs pass
# uses the real Pango text engine, so it doubles as a load-and-draw smoke test.
preview:
	gjs -m scripts/render-shell-preview.js
	gjs -m scripts/svg2png.js docs/logo.svg docs/logo.png 1
	gjs -m scripts/svg2png.js docs/architecture.svg docs/architecture.png 1

deb: test check
	./scripts/build-deb.sh

clean:
	rm -rf dist backend/codenotch/__pycache__

# Refresh the checksum manifest that ships with a release tarball.
sums:
	@find . \( -name .git -o -name .idea -o -name .vscode -o -name dist -o -name build -o -name __pycache__ -o -name node_modules \) -prune -o \
		-type f ! -name SHA256SUMS -print | sed 's|^\./||' | LC_ALL=C sort | xargs sha256sum > SHA256SUMS
	@echo "SHA256SUMS: $$(wc -l < SHA256SUMS) files"
