#!/bin/sh
# Copy the mod into the installed-plugin cache (other sessions load from there until they
# /reload-plugins), or into any folder given as $1.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DST="${1:-$HOME/.claude/plugins/cache/claude-ide/claude-ide/0.1.0}"
mkdir -p "$DST"
rsync -a --delete --exclude .git --exclude .claude-plugin/types --exclude node_modules "$SRC/" "$DST/"
echo "synced -> $DST"
