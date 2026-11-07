#!/usr/bin/env bash
# Fetch TestFlight crash logs through CI and decrypt them into build/testflight-crashes/ (gitignored).
#   tools/testflight-crashes.sh [limit]
# Runs .github/workflows/testflight-crashes.yml on main, which holds the App Store Connect key. Needs gh, openssl, tar.
# The first run creates a throwaway RSA key and certificate in ~/.config/kanaf; the workflow encrypts to the certificate.
set -euo pipefail

repo=omercnet/openefb
workflow=testflight-crashes.yml
limit=${1:-20}
keydir=$HOME/.config/kanaf
out=$(cd "$(dirname "$0")/.." && pwd)/build/testflight-crashes

if [[ ! -f $keydir/crashes.key ]]; then
  (umask 077 && mkdir -p "$keydir" && openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj "/CN=kanaf-crashes" \
    -keyout "$keydir/crashes.key" -out "$keydir/crashes.pem" 2>/dev/null)
fi

before=$(gh run list -R "$repo" --workflow "$workflow" --limit 1 --json databaseId -q '.[0].databaseId // 0')
gh workflow run "$workflow" -R "$repo" --ref main -f recipient_cert="$(base64 <"$keydir/crashes.pem" | tr -d '\n')" -f limit="$limit"

run=$before
for _ in $(seq 30); do
  sleep 2
  run=$(gh run list -R "$repo" --workflow "$workflow" --limit 1 --json databaseId -q '.[0].databaseId // 0')
  [[ $run != "$before" ]] && break
done
[[ $run != "$before" ]] || { echo "the workflow run did not start" >&2; exit 1; }

gh run watch "$run" -R "$repo" --exit-status >/dev/null
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
gh run download "$run" -R "$repo" -n crashes -D "$tmp"
# Decrypt into a private temporary folder first, so a failure keeps the previous logs.
(umask 077 && mkdir "$tmp/out")
openssl cms -decrypt -binary -inform DER -in "$tmp/crashes.tgz.cms" -recip "$keydir/crashes.pem" -inkey "$keydir/crashes.key" |
  tar -xzC "$tmp/out"
rm -rf "$out"
mkdir -p "$(dirname "$out")"
mv "$tmp/out" "$out"
echo "wrote $(find "$out" -name '*.crash' | wc -l | tr -d ' ') crash logs to $out"
