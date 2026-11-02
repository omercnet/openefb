#!/bin/bash
# Archive, export and upload OpenEFB to TestFlight.
#
# Default: uses the Apple ID Xcode is signed in to (Xcode > Settings > Accounts, team 6F8N897928).
# Optional fallback: if ASC_KEY_ID and ASC_ISSUER_ID are both set, an App Store Connect API key is used instead, read from
#   ~/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8   (the script refuses to run if that file is missing).
#
# Build number: CURRENT_PROJECT_VERSION = BUILD_NUMBER if set, else `git rev-list --count HEAD`. It must be higher than every
# earlier upload of the same version. The App Store Connect app record for io.omer.efb must already exist.
# Never prints secrets. Do not run until the app record exists.
set -euo pipefail

cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

AUTH=(-allowProvisioningUpdates)
if [ -n "${ASC_KEY_ID:-}" ] || [ -n "${ASC_ISSUER_ID:-}" ]; then
  : "${ASC_KEY_ID:?ASC_ISSUER_ID is set, so ASC_KEY_ID is required too}"
  : "${ASC_ISSUER_ID:?ASC_KEY_ID is set, so ASC_ISSUER_ID is required too}"
  KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
  if [ ! -f "$KEY_PATH" ]; then
    echo "error: API key file not found: $KEY_PATH" >&2
    exit 2
  fi
  AUTH+=(-authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
  echo "Auth: App Store Connect API key"
else
  echo "Auth: Apple ID signed in to Xcode"
fi

BUILD="${BUILD_NUMBER:-$(git rev-list --count HEAD)}"
case "$BUILD" in ''|*[!0-9]*) echo "error: build number '$BUILD' is not an integer" >&2; exit 2;; esac

OUT="${OUT_DIR:-/tmp/openefb-testflight-$BUILD}"
rm -rf "$OUT"; mkdir -p "$OUT"

echo "Archiving build $BUILD ..."
xcodebuild archive -project efb-212.xcodeproj -scheme efb-212 -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/OpenEFB.xcarchive" \
  CURRENT_PROJECT_VERSION="$BUILD" "${AUTH[@]}" > "$OUT/archive.log" 2>&1 \
  || { echo "archive failed; see $OUT/archive.log" >&2; exit 1; }

echo "Exporting and uploading (ExportOptions.plist destination=upload) ..."
xcodebuild -exportArchive -archivePath "$OUT/OpenEFB.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist dist-prep/ExportOptions.plist "${AUTH[@]}" > "$OUT/export.log" 2>&1 \
  || { echo "export/upload failed; see $OUT/export.log" >&2; exit 1; }

echo "Uploaded build $BUILD. It appears in TestFlight after Apple's processing (minutes)."
echo "Next: add it to the internal group; do not submit for external review without the owner's go-ahead."
