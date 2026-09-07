.PHONY: test deb check

test:
	PYTHONPATH=backend python3 -m unittest discover -s tests -v
	node tests/test-layout.mjs

check:
	python3 -m compileall -q backend
	node --check extension/extension.js
	node --check extension/prefs.js
	node --check extension/render.js


deb: test check
	./scripts/build-deb.sh
