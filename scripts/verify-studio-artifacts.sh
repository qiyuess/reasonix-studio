#!/usr/bin/env bash
set -euo pipefail
dir=${1:?usage: verify-studio-artifacts.sh DIRECTORY}
for arch in amd64 arm64; do
  for name in "ReasonixStudio-linux-$arch.deb" "ReasonixStudio-linux-$arch.rpm" "ReasonixStudio-linux-$arch.AppImage" \
    "ReasonixStudio-darwin-$arch.dmg" "ReasonixStudio-darwin-$arch.zip"; do
    test -s "$dir/$name" || { echo "missing or empty Studio artifact: $name" >&2; exit 1; }
  done
done
# Windows ships amd64 and nothing else, so an arm64 package is not required —
# and one that appeared would mean the release grew a leg it does not sign.
for name in "ReasonixStudio-windows-amd64-installer.exe" "ReasonixStudio-windows-amd64.zip"; do
  test -s "$dir/$name" || { echo "missing or empty Studio artifact: $name" >&2; exit 1; }
done
if compgen -G "$dir/ReasonixStudio-windows-arm64*" > /dev/null; then
  echo "unexpected Windows arm64 Studio artifact: Windows releases are amd64 only" >&2
  exit 1
fi
