#!/usr/bin/env python3
"""Fails when a built iOS app links code for a privacy-sensitive API without the Info.plist purpose string Apple requires.

Apple rejects such a binary while it processes it (ITMS-90683, "Missing purpose string in Info.plist"), after the upload
already succeeded and with the reason only in an email. This runs on the unsigned archive of the PR-time job, so it cannot reach
Apple again.

    check_purpose_strings.py <App.app> [--production] [--symbols-from FILE]

For the main executable and every framework inside the app it lists the undefined symbols (`nm -u`, which names every Apple class
the code uses, in Objective-C and in Swift's mangled form) and looks for the classes below. A class that is used needs one of the
listed Info.plist keys, with a non-empty value. The check prints what it found either way, so a failure says which binary and
which class.

--production also fails when the app carries what only a development client adds: the Dev Launcher's Bonjour service and its
"exp+" URL scheme in Info.plist, and any EXDevLauncher / EXDevMenu symbol in a binary.

--symbols-from FILE reads the symbol list from a file instead of running nm (tests).
"""
from __future__ import annotations

import argparse
import plistlib
import re
import subprocess
import sys
from pathlib import Path

# Framework -> (a class-name pattern that proves the code uses it, the keys of which at least one must be a non-empty string).
SENSITIVE = {
    "Photos": (
        re.compile(r"PHPhotoLibrary|PHAsset|ALAssetsLibrary"),
        ("NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"),
    ),
    "Camera": (
        re.compile(r"AVCaptureDevice|AVCaptureSession|UIImagePickerController"),
        ("NSCameraUsageDescription",),
    ),
    "Contacts": (re.compile(r"CNContactStore|ABAddressBook"), ("NSContactsUsageDescription",)),
    "Location": (
        re.compile(r"CLLocationManager"),
        ("NSLocationWhenInUseUsageDescription", "NSLocationAlwaysAndWhenInUseUsageDescription"),
    ),
    "Microphone": (re.compile(r"AVAudioRecorder|AVAudioInputNode"), ("NSMicrophoneUsageDescription",)),
    "Speech": (
        re.compile(r"SFSpeechRecognizer|SFSpeechAudioBufferRecognitionRequest|SpeechTranscriber"),
        ("NSSpeechRecognitionUsageDescription",),
    ),
    "Bluetooth": (
        re.compile(r"CBCentralManager|CBPeripheralManager"),
        ("NSBluetoothAlwaysUsageDescription", "NSBluetoothPeripheralUsageDescription"),
    ),
    # Motion & Fitness: activity, pedometer and altimeter data. NOT CMMotionManager (raw accelerometer and gyroscope), which needs
    # no permission: react-native-reanimated links it, and the build that Apple accepted before did too.
    "Motion": (re.compile(r"CMMotionActivityManager|CMPedometer|CMAltimeter"), ("NSMotionUsageDescription",)),
}

# Expo's development client only. React Native core links its own RCTDevMenu / RCTDevSettings in every build, so a bare "DevMenu"
# would match that (the first run of this check did).
DEV_CLIENT_SYMBOLS = re.compile(r"EXDevLauncher|EXDevMenu|ExpoDevLauncher|ExpoDevMenu|expo_dev_launcher|expo_dev_menu|DevLauncherController")


def load_plist(path: Path) -> dict:
    with path.open("rb") as handle:
        return plistlib.load(handle)


def binaries(app: Path, info: dict) -> list[Path]:
    """The main executable and the executable of every framework in the app (static pods are linked into the first)."""
    found = [app / info["CFBundleExecutable"]]
    for framework in sorted((app / "Frameworks").glob("*.framework")):
        executable = framework / framework.stem
        if executable.is_file():
            found.append(executable)
    return found


def undefined_symbols(binary: Path) -> str:
    result = subprocess.run(["nm", "-u", str(binary)], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"nm -u {binary.name} failed: {result.stderr.strip()[:200]}")
    return result.stdout


def has_string(info: dict, key: str) -> bool:
    value = info.get(key)
    return isinstance(value, str) and value.strip() != ""


def check(info: dict, symbols_by_binary: dict[str, str], production: bool) -> tuple[list[str], list[str]]:
    """Returns (report lines, problems)."""
    report: list[str] = []
    problems: list[str] = []
    for framework, (pattern, keys) in SENSITIVE.items():
        users = {}
        for name, symbols in symbols_by_binary.items():
            hits = sorted(set(pattern.findall(symbols)))
            if hits:
                users[name] = hits
        if not users:
            continue
        where = "; ".join(f"{name}: {', '.join(hits)}" for name, hits in users.items())
        present = [key for key in keys if has_string(info, key)]
        if present:
            report.append(f"ok   {framework}: used ({where}); purpose string {present[0]}")
        else:
            report.append(f"FAIL {framework}: used ({where}); no purpose string")
            problems.append(f"{framework} is linked ({where}) but Info.plist has none of {', '.join(keys)}")

    if production:
        for name, symbols in symbols_by_binary.items():
            hits = sorted(set(DEV_CLIENT_SYMBOLS.findall(symbols)))
            if hits:
                problems.append(f"{name} contains development client code ({', '.join(hits)})")
        if info.get("NSBonjourServices"):
            problems.append(f"Info.plist has NSBonjourServices {info['NSBonjourServices']!r} (the Dev Launcher's)")
        for entry in info.get("CFBundleURLTypes", []):
            for scheme in entry.get("CFBundleURLSchemes", []):
                if str(scheme).startswith("exp+"):
                    problems.append(f"Info.plist has the development URL scheme {scheme!r}")
    return report, problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("app", type=Path)
    parser.add_argument("--production", action="store_true")
    parser.add_argument("--symbols-from", type=Path, help="symbol list for every binary (tests)")
    args = parser.parse_args(argv)

    info = load_plist(args.app / "Info.plist")
    if args.symbols_from:
        symbols = {info.get("CFBundleExecutable", "app"): args.symbols_from.read_text()}
    else:
        symbols = {binary.name: undefined_symbols(binary) for binary in binaries(args.app, info)}

    print(f"{info.get('CFBundleIdentifier')} {info.get('CFBundleShortVersionString')} ({info.get('CFBundleVersion')}): "
          f"{len(symbols)} binaries scanned")
    report, problems = check(info, symbols, args.production)
    for line in report:
        print(line)
    if not report:
        print("no privacy-sensitive framework is used")
    for problem in problems:
        print(f"::error::{problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
