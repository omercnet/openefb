#!/bin/bash
# Archive, export and upload OpenEFB to TestFlight, entirely from the command line.
#
# Auth: an App Store Connect API key. Put the key ID and issuer ID in ~/.appstoreconnect/openefb.env
# (export ASC_KEY_ID=… / export ASC_ISSUER_ID=…) and the key at ~/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8.
# The script refuses to run without them and never prints secrets.
#
# Signing: manual, with the local Apple Distribution certificate and the "io.omer.efb AppStore" profile.
# Cloud signing needs an Admin key, and Xcode 27 command-line tools can't read Xcode's Apple Account token, so we don't
# use either. The first run (or an expired certificate/profile) creates them with fastlane `cert` and `sigh` using the same key.
#
# Build number: CURRENT_PROJECT_VERSION = BUILD_NUMBER if set, else `git rev-list --count HEAD`. It must be higher than
# every earlier upload of the same version. The App Store Connect app record for io.omer.efb must exist.
set -euo pipefail

cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

ENV_FILE="$HOME/.appstoreconnect/openefb.env"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
: "${ASC_KEY_ID:?set ASC_KEY_ID (see $ENV_FILE)}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID (see $ENV_FILE)}"
KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
[ -f "$KEY_PATH" ] || { echo "error: API key file not found: $KEY_PATH" >&2; exit 2; }
AUTH=(-authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")

PROFILE_NAME="io.omer.efb AppStore"
if ! security find-identity -v -p codesigning | grep -q "Apple Distribution" \
   || ! grep -rlq "$PROFILE_NAME" "$HOME/Library/MobileDevice/Provisioning Profiles" 2>/dev/null; then
  command -v fastlane >/dev/null || { echo "error: fastlane is needed to create signing assets (brew install fastlane)" >&2; exit 2; }
  JSON="$(mktemp)"; trap 'rm -f "$JSON"' EXIT
  python3 - "$ASC_KEY_ID" "$ASC_ISSUER_ID" "$KEY_PATH" "$JSON" <<'PY'
import json, sys
kid, iss, path, out = sys.argv[1:]
json.dump({"key_id": kid, "issuer_id": iss, "key": open(path).read(), "in_house": False}, open(out, "w"))
PY
  echo "Creating signing assets (Apple Distribution certificate, App Store profile) ..."
  export FASTLANE_SKIP_UPDATE_CHECK=1 FASTLANE_OPT_OUT_USAGE=1
  fastlane cert --api_key_path "$JSON" --development false --platform ios > /dev/null
  fastlane sigh --api_key_path "$JSON" --app_identifier io.omer.efb --platform ios > /dev/null
fi

BUILD="${BUILD_NUMBER:-$(git rev-list --count HEAD)}"
case "$BUILD" in ''|*[!0-9]*) echo "error: build number '$BUILD' is not an integer" >&2; exit 2;; esac

OUT="${OUT_DIR:-/tmp/openefb-testflight-$BUILD}"
rm -rf "$OUT"; mkdir -p "$OUT"

echo "Archiving build $BUILD ..."
xcodebuild archive -project efb-212.xcodeproj -scheme efb-212 -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/OpenEFB.xcarchive" \
  CURRENT_PROJECT_VERSION="$BUILD" -allowProvisioningUpdates "${AUTH[@]}" > "$OUT/archive.log" 2>&1 \
  || { echo "archive failed; see $OUT/archive.log" >&2; exit 1; }

echo "Exporting and uploading (dist-prep/ExportOptions.plist, manual signing, destination=upload) ..."
xcodebuild -exportArchive -archivePath "$OUT/OpenEFB.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist dist-prep/ExportOptions.plist "${AUTH[@]}" > "$OUT/export.log" 2>&1 \
  || { echo "export/upload failed; see $OUT/export.log" >&2; exit 1; }
grep -q "Upload succeeded" "$OUT/export.log" || { echo "upload did not report success; see $OUT/export.log" >&2; exit 1; }

echo "Uploaded build $BUILD. It appears in TestFlight after Apple's processing (minutes)."
echo "Next: it is available to the internal group; do not submit for external review without the owner's go-ahead."
