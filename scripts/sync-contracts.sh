#!/usr/bin/env bash
# Vendors the card contract files from PickMe into MoneyTalks/contracts/ and
# regenerates MANIFEST.json (sha256 per file) so the drift-check test can
# detect a stale copy. Usage: scripts/sync-contracts.sh [/path/to/PickMe/contracts]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="${1:-$REPO_ROOT/../PickMe/contracts}"
DEST="$REPO_ROOT/contracts"

if [ ! -d "$SOURCE" ]; then
  echo "sync-contracts: source directory not found: $SOURCE" >&2
  exit 1
fi

# Relative to $SOURCE / $DEST. Keep in sync with the expected file list in
# src/lib/contracts/contracts.test.ts.
FILES=(
  "card-catalogue.json"
  "benefits-catalogue.json"
  "engine-fixtures.json"
  "schema/card-catalogue.schema.json"
  "schema/benefits-catalogue.schema.json"
  "schema/engine-fixtures.schema.json"
)

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

mkdir -p "$DEST/schema"

for f in "${FILES[@]}"; do
  src="$SOURCE/$f"
  if [ ! -f "$src" ]; then
    echo "sync-contracts: missing source file: $src" >&2
    exit 1
  fi
  cp "$src" "$DEST/$f"
done

manifest="$DEST/MANIFEST.json"
tmp_manifest="$manifest.tmp"
{
  echo "{"
  last_index=$((${#FILES[@]} - 1))
  for i in "${!FILES[@]}"; do
    f="${FILES[$i]}"
    hash=$(sha256_of "$DEST/$f")
    if [ "$i" -eq "$last_index" ]; then
      printf '  "%s": "%s"\n' "$f" "$hash"
    else
      printf '  "%s": "%s",\n' "$f" "$hash"
    fi
  done
  echo "}"
} > "$tmp_manifest"
mv "$tmp_manifest" "$manifest"

echo "sync-contracts: synced ${#FILES[@]} files from $SOURCE"
