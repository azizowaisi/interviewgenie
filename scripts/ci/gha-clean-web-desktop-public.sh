#!/usr/bin/env bash
# Remove shipped desktop binaries under web/public/desktop before staging a fresh CI bundle.
# Keeps .gitkeep and other non-installer files. Usage: run from repo root.
set -euo pipefail

DEST="${1:-web/public/desktop}"
mkdir -p "$DEST"
find "$DEST" -maxdepth 1 -type f \( \
  -name "*.dmg" -o -name "*.exe" -o -name "*.AppImage" -o -name "*.appimage" -o -name "*.blockmap" \
\) -delete
