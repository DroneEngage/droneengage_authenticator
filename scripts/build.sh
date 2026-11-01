#!/usr/bin/env bash
# Release build: compiles the binaries and copies them with the runtime
# files (configuration, views, public, wiki, database migrations, scripts,
# ssl_local) into build/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build"
cd "$ROOT"
scripts/local_server_common.sh
cargo build --release
rm -rf "$OUT"
mkdir -p "$OUT"
cp target/release/andruavauth target/release/reset_access target/release/migrate_file_db "$OUT/"
for f in server.config views public wiki database scripts ssl_local resources README.md CHANGELOG.md; do
  [ -e "$f" ] && cp -r "$f" "$OUT/"
done
echo "Build output written to: $OUT"
