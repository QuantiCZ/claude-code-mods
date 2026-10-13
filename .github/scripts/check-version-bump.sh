#!/usr/bin/env bash
# Fail if a plugin has non-docs changes since <base> but its plugin.json version did not increase.
# Usage: check-version-bump.sh <base-ref-or-sha>
set -euo pipefail

base="${1:?usage: check-version-bump.sh <base>}"
if [[ "$base" =~ ^0+$ ]]; then
  echo "No previous commit to compare against; skipping."
  exit 0
fi

version_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version||""))'; }

mb=$(git merge-base "$base" HEAD)
status=0

for dir in plugins/*/; do
  dir="${dir%/}"
  manifest="$dir/.claude-plugin/plugin.json"

  changed=$(git diff --name-only "$mb" HEAD -- "$dir" | grep -vE '\.md$' || true)
  [[ -z "$changed" ]] && continue

  if ! git cat-file -e "$mb:$manifest" 2>/dev/null; then
    echo "$dir: new plugin, no bump required."
    continue
  fi

  old=$(git show "$mb:$manifest" | version_of)
  new=$(version_of < "$manifest")

  if [[ -z "$new" ]]; then
    echo "::error file=$manifest::$dir has no \"version\" in plugin.json."
    status=1
  elif [[ "$old" == "$new" ]] || [[ "$(printf '%s\n%s\n' "$old" "$new" | sort -V | tail -n1)" != "$new" ]]; then
    echo "::error file=$manifest::$dir changed but version is still $old (new: $new). Bump it (semver: patch for fixes, minor for features)."
    echo "Changed files:"; echo "$changed" | sed 's/^/  /'
    status=1
  else
    echo "$dir: $old -> $new OK"
  fi
done

exit $status
