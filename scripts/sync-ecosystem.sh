#!/usr/bin/env bash
# Mirror the canonical ECOSYSTEM.md into the sibling ecosystem repos.
#
#   ./scripts/sync-ecosystem.sh          copy canonical -> siblings
#   ./scripts/sync-ecosystem.sh --check  verify only; non-zero exit if stale
#
# Canonical copy is MoneyTalks/ECOSYSTEM.md. Edit that one, never a mirror.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/ECOSYSTEM.md"
SIBLINGS=(PickMe return-saas marketdata)
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

[[ -f "$SRC" ]] || { echo "fatal: canonical $SRC missing"; exit 1; }
stamp() { grep -o 'ecosystem-sync: [^ ]* [0-9-]*' "$1" 2>/dev/null || echo "(no stamp)"; }

echo "canonical: $(stamp "$SRC")"
stale=0 missing=0

for repo in "${SIBLINGS[@]}"; do
  dst="$ROOT/../$repo/ECOSYSTEM.md"
  if [[ ! -d "$ROOT/../$repo" ]]; then
    echo "  SKIP $repo — not checked out beside MoneyTalks"
    missing=1
    continue
  fi
  if [[ -f "$dst" ]] && cmp -s "$SRC" "$dst"; then
    echo "  ok   $repo — $(stamp "$dst")"
    continue
  fi
  if (( CHECK )); then
    echo "  STALE $repo — $(stamp "$dst")"
    stale=1
  else
    cp "$SRC" "$dst"
    echo "  sync $repo — $(stamp "$dst")"
  fi
done

if (( CHECK && stale )); then
  echo
  echo "Mirrors are stale. Run ./scripts/sync-ecosystem.sh from MoneyTalks."
  exit 1
fi
(( missing )) && echo $'\nSome repos were not beside MoneyTalks; their mirrors were not updated.'
exit 0
