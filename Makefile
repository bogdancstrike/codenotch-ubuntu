.PHONY: test deb check preview clean

test:
	PYTHONPATH=backend python3 -m unittest discover -s tests -v
	node tests/test-layout.mjs

check:
	python3 -m compileall -q backend
	node --check extension/extension.js
	node --check extension/prefs.js
	node --check extension/render.js

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
