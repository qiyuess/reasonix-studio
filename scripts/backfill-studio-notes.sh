#!/usr/bin/env bash
# One-time backfill of release notes for the versions already in the Studio
# catalog: write studio/notes/<version>.md for each entry without a notes field,
# then add the field to those entries. A version whose tag carries no notes file
# keeps no field. Notes already on the site are never rewritten.
#
# The catalog, its notes and each version's manifest are nested paths, so they
# live on the Pages branch, not in a release: /releases/download addresses one
# tag and one flat file name, and could not hold "studio/notes/2.31.0.md" at
# all. This reads and writes that branch, in one commit.
#
# Dry-run unless --apply is given. Needs GH_TOKEN (or gh login) for the credit
# lookups the renderer makes and for the push. Run it from a clone that has the
# studio tags.
#
#   backfill-studio-notes.sh [--apply]
set -euo pipefail

apply=false
case "${1:-}" in
  "") ;;
  --apply) apply=true ;;
  *) echo "usage: $0 [--apply]" >&2; exit 2 ;;
esac

here="$(cd "$(dirname "$0")" && pwd)"
repo="${BACKFILL_REPO:-$(cd "$here/.." && pwd)}"
site_repo="${SITE_REPO:-$repo}"
site_branch="${SITE_BRANCH:-gh-pages}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/rendered"
base="https://qiyuess.github.io/reasonix-studio/studio/notes"

idle() {
  local busy
  busy="$(gh run list --workflow release-studio.yml --limit 30 --json status --jq '[.[] | select(.status != "completed")] | length')"
  [ "$busy" = "0" ]
}

# The site is a git branch, so a clone is the read and the write at once: what
# this dir holds after `push` is exactly what a client fetches.
clone_site() {
  rm -rf "$work/site"
  git clone --quiet --depth 1 --branch "$site_branch" "$site_repo" "$work/site"
  jq -e '.versions | type == "array"' "$work/site/studio/versions.json" >/dev/null
  mkdir -p "$work/site/studio/notes"
}

has_object() {
  [ -f "$work/site/studio/notes/$1.md" ]
}

if $apply && ! idle; then
  echo "refusing: a release-studio.yml run is queued or in progress; its catalog write would race this one" >&2
  exit 1
fi

clone_site
have=()
# jq ends each line with CRLF on Windows, and a carriage return inside the
# version would become part of a tag name git then refuses ("studio-v2.3.0?",
# the "?" being that CR). Stripping it makes the loop read the same names on
# every platform.
while IFS= read -r version; do
  v="${version%$'\r'}"   # strip the CR jq appends on Windows
  v="${v#v}"
  if has_object "$v"; then
    echo "exists   $v"
    have+=("$v")
    continue
  fi
  if ! git -C "$repo" show "studio-v$v:release-notes/studio/$v.md" > "$work/$v.src.md" 2>/dev/null; then
    echo "no notes $v"
    continue
  fi
  if ! $apply; then
    echo "would write $v"
    have+=("$v")
    continue
  fi
  # Rendered into its own directory: the branch is cloned again before the
  # commit (a release may have landed while these were rendering), and a note
  # left inside the first clone would go with it.
  node "$here/studio-release-notes.mjs" "$work/$v.src.md" "$work/rendered/$v.md"
  echo "wrote $v"
  have+=("$v")
done < <(jq -r '.versions[] | select((.notes // "") == "") | .version' "$work/site/studio/versions.json")

if ! $apply; then
  echo "dry run: ${#have[@]} entries would carry notes; rerun with --apply"
  exit 0
fi

# Notes first, catalog last: an entry naming a notes object must not land in a
# commit that leaves the object out. Both travel together, so re-read the branch
# and stop if a release started while the notes were rendering.
idle || { echo "refusing to write the catalog: a release run started" >&2; exit 1; }
clone_site
# The notes rendered before the re-read land in this clone now, so they travel
# in the same commit as the catalog entries that name them.
if compgen -G "$work/rendered/*.md" > /dev/null; then
  cp "$work/rendered/"*.md "$work/site/studio/notes/"
fi
printf '%s\n' "${have[@]:-}" | jq -R . | jq -s 'map(select(. != ""))' > "$work/have.json"
jq --slurpfile have "$work/have.json" --arg base "$base" '
  .versions |= map(
    (.version | ltrimstr("v")) as $n
    | if (.notes // "") == "" and ($have[0] | index($n) != null)
      then . + {notes: ($base + "/" + $n + ".md")}
      else . end)' "$work/site/studio/versions.json" > "$work/next.json"
jq -e '.versions | length > 0' "$work/next.json" >/dev/null
mv "$work/next.json" "$work/site/studio/versions.json"

cd "$work/site"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then
  echo "the site already carries those notes"
  exit 0
fi
git commit -q -m "catalog: backfill release notes"
git push --quiet origin "$site_branch"
echo "catalog updated: ${#have[@]} entries carry notes"
