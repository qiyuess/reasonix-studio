#!/usr/bin/env bash
set -euo pipefail
dir=${1:?usage: verify-studio-artifacts.sh DIRECTORY}
# This line publishes one Windows artifact, the amd64 installer: it is what a
# person downloads and what the updater runs. macOS and Linux are not built at
# all, and the portable zip went with them, so requiring either here would fail
# a release that is complete.
for name in "ReasonixStudio-windows-amd64-installer.exe"; do
  test -s "$dir/$name" || { echo "missing or empty Studio artifact: $name" >&2; exit 1; }
done
# A package that reappeared means the release grew a leg nothing signs or
# verifies, so it is refused rather than quietly published.
for stray in "ReasonixStudio-windows-arm64" "ReasonixStudio-windows-amd64.zip" \
  "ReasonixStudio-linux-" "ReasonixStudio-darwin-"; do
  if compgen -G "$dir/$stray*" > /dev/null; then
    echo "unexpected Studio artifact: $stray* — this line publishes the Windows amd64 installer only" >&2
    exit 1
  fi
done
