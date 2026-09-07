#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD_DIR=$(mktemp -d)
trap 'rm -rf -- "$BUILD_DIR"' EXIT HUP INT TERM
INSTALL_ROOT="$BUILD_DIR/root"
EXT_DIR="$INSTALL_ROOT/usr/share/gnome-shell/extensions/codenotch@ubuntu.local"
mkdir -p "$INSTALL_ROOT/DEBIAN" "$INSTALL_ROOT/usr/lib/codenotch/codenotch" "$EXT_DIR" "$INSTALL_ROOT/usr/bin" "$INSTALL_ROOT/usr/share/applications" "$INSTALL_ROOT/usr/share/icons/hicolor/256x256/apps" "$INSTALL_ROOT/usr/share/doc/codenotch" "$PROJECT_DIR/dist"
install -m 644 "$PROJECT_DIR/packaging/control" "$INSTALL_ROOT/DEBIAN/control"
install -m 644 "$PROJECT_DIR"/backend/codenotch/*.py "$INSTALL_ROOT/usr/lib/codenotch/codenotch/"
install -m 755 "$PROJECT_DIR/backend/codenotch-worker" "$INSTALL_ROOT/usr/lib/codenotch/codenotch-worker"
install -m 644 "$PROJECT_DIR"/extension/*.js "$PROJECT_DIR/extension/metadata.json" "$PROJECT_DIR/extension/stylesheet.css" "$EXT_DIR/"
install -m 755 "$PROJECT_DIR/packaging/codenotch" "$INSTALL_ROOT/usr/bin/codenotch"
install -m 644 "$PROJECT_DIR/packaging/codenotch.desktop" "$INSTALL_ROOT/usr/share/applications/"
install -m 644 "$PROJECT_DIR/packaging/codenotch.png" "$INSTALL_ROOT/usr/share/icons/hicolor/256x256/apps/codenotch.png"
install -m 644 "$PROJECT_DIR/LICENSE" "$INSTALL_ROOT/usr/share/doc/codenotch/copyright"
install -m 644 "$PROJECT_DIR/README.md" "$PROJECT_DIR/docs/PORTING.md" "$INSTALL_ROOT/usr/share/doc/codenotch/"
find "$INSTALL_ROOT" -type d -exec chmod 755 {} +
dpkg-deb --root-owner-group --build "$INSTALL_ROOT" "$PROJECT_DIR/dist/codenotch_0.2.0_all.deb"
