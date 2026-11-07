#!/usr/bin/env python3
"""Download the newest TestFlight crash submissions: <id>.json (tester comment, device, build) and <id>.crash (log).

Credentials as in fastlane/Fastfile: ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_P8 (key contents) or ASC_KEY_PATH
(default ~/.appstoreconnect/private_keys/AuthKey_<id>.p8). When ASC_KEY_ID is unset the ids come from
~/.appstoreconnect/openefb.env. Standard library only; the JWT is signed with the openssl command.

Prints only counts: in CI (.github/workflows/testflight-crashes.yml) the log is public.
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.appstoreconnect.apple.com/v1"
APP_ID = "6829641724"  # Kanaf EFB in App Store Connect


def load_local_env():
    env_file = Path.home() / ".appstoreconnect/openefb.env"
    if os.environ.get("ASC_KEY_ID") or not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        m = re.match(r"\s*(?:export\s+)?(ASC_[A-Z_]+)=(.*)$", line)
        if m:
            os.environ.setdefault(m[1], m[2].strip().strip("'\""))


def env(name):
    value = os.environ.get(name)
    if not value:
        sys.exit(f"{name} is not set")
    return value


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def der_to_jose(der):
    """ECDSA P-256 DER signature (SEQUENCE of two INTEGERs) to the 64-byte r||s form ES256 uses."""
    out, i = b"", 2
    for _ in range(2):
        length = der[i + 1]
        out += der[i + 2 : i + 2 + length].lstrip(b"\0").rjust(32, b"\0")
        i += 2 + length
    return out


def token():
    key_id, issuer = env("ASC_KEY_ID"), env("ASC_ISSUER_ID")
    key = os.environ.get("ASC_KEY_P8") or Path(
        os.environ.get("ASC_KEY_PATH") or Path.home() / f".appstoreconnect/private_keys/AuthKey_{key_id}.p8"
    ).read_text()
    now = int(time.time())
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    claims = {"iss": issuer, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"}
    signing_input = f"{b64url(json.dumps(header).encode())}.{b64url(json.dumps(claims).encode())}"
    with tempfile.NamedTemporaryFile("w", suffix=".p8") as f:  # created 0600
        f.write(key)
        f.flush()
        der = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", f.name],
            input=signing_input.encode(),
            capture_output=True,
            check=True,
        ).stdout
    return f"{signing_input}.{b64url(der_to_jose(der))}"


def get(path, jwt):
    request = urllib.request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {jwt}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--app", default=APP_ID, help="App Store Connect app id")
    parser.add_argument("--limit", type=int, default=20, help="newest submissions to fetch (1-200)")
    parser.add_argument("--out", type=Path, default=Path("build/testflight-crashes"))
    args = parser.parse_args()

    load_local_env()
    jwt = token()
    try:
        limit = max(1, min(args.limit, 200))
        submissions = get(f"/apps/{args.app}/betaFeedbackCrashSubmissions?sort=-createdDate&limit={limit}", jwt)["data"]
        args.out.mkdir(parents=True, exist_ok=True)
        logs = 0
        for submission in submissions:
            sid = submission["id"]
            (args.out / f"{sid}.json").write_text(json.dumps(submission, indent=2))
            try:
                log = get(f"/betaFeedbackCrashSubmissions/{sid}/crashLog", jwt)["data"]["attributes"]["logText"]
            except urllib.error.HTTPError as e:
                if e.code != 404:
                    raise
                continue
            (args.out / f"{sid}.crash").write_text(log)
            logs += 1
    except urllib.error.HTTPError as e:
        sys.exit(f"App Store Connect API: HTTP {e.code} {e.read().decode(errors='replace')}")
    print(f"{len(submissions)} crash submissions, {logs} crash logs")


if __name__ == "__main__":
    main()
