#!/usr/bin/env bash
# Mirror canonical cross-repo documents into their sibling repos.
#
#   ./scripts/sync/sync-ecosystem.sh          copy canonical -> siblings
#   ./scripts/sync/sync-ecosystem.sh --check  verify only; non-zero exit if stale
#
# Canonical copies:
#   MoneyTalks/ECOSYSTEM.md
#   agent-orchestrator/FLEET.md
# Edit those, never a mirror.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

stale=0 missing=0

sync_mirrors() {
  local file="$1"
  local src="$2"
  shift 2

  if [[ ! -f "$src" ]]; then
    echo "SKIP $file — canonical copy is not checked out at $src"
    missing=1
    return
  fi

  echo "$file canonical: $src"
  for repo in "$@"; do
    local repo_root="$ROOT/../$repo"
    [[ "$repo" == "MoneyTalks" ]] && repo_root="$ROOT"

    if [[ ! -d "$repo_root" ]]; then
      echo "  SKIP $repo — not checked out beside MoneyTalks"
      missing=1
      continue
    fi

    local dst="$repo_root/$file"
    if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
      echo "  ok   $repo"
      continue
    fi

    if (( CHECK )); then
      echo "  STALE $repo"
      stale=1
    else
      cp "$src" "$dst"
      echo "  sync $repo"
    fi
  done
}

sync_mirrors "ECOSYSTEM.md" "$ROOT/ECOSYSTEM.md" PickMe return-saas marketdata
sync_mirrors "FLEET.md" "$ROOT/../agent-orchestrator/FLEET.md" \
  MoneyTalks PickMe return-saas marketdata pickleball-session-manager

if (( CHECK && stale )); then
  echo
  echo "Mirrors are stale. Run ./scripts/sync/sync-ecosystem.sh from MoneyTalks."
  exit 1
fi
(( missing )) && echo $'\nSome repos were not beside MoneyTalks; their mirrors were not updated.'
exit 0
