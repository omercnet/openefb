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
"exp+" URL scheme in Info.plist, and any EXDevLauncher / EXDevMenu symbol, defined or undefined, in a binary (a statically linked
class is DEFINED in the executable, so `nm -u` alone would never show it).

--symbols-from FILE reads the symbol list from a file instead of running nm (tests).
"""
from __future__ import annotations

import argparse
import plistlib
import re
import subprocess
import sys
from pathlib import Path

# AVCaptureDevice as a whole class name, never as the start of AVCaptureDeviceInput: after `nm` an Objective-C reference ends the
# line, and a Swift-mangled one carries the name's length (15) in front of it.
AV_CAPTURE_DEVICE = r"(?:_OBJC_(?:META)?CLASS_\$_AVCaptureDevice(?![A-Za-z0-9_])|(?<![0-9])15AVCaptureDevice)"
AV_CAPTURE_DEVICE_RE = re.compile(AV_CAPTURE_DEVICE)

# Framework -> (a class-name pattern that proves the code uses it, the keys of which at least one must be a non-empty string).
SENSITIVE = {
    "Photos": (
        re.compile(r"PHPhotoLibrary|PHAsset|ALAssetsLibrary"),
        ("NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"),
    ),
    # AVCaptureDevice is how the camera is asked for AND how the microphone is (media type audio); the symbol list cannot tell which.
    # The safe reading is camera use: a missing string would crash the app when it asks for the camera and be rejected by Apple.
    # A dependency (a binary, named) reviewed to use it for audio only is allowed by hand with --audio-only-capture-device NAME: that
    # binary's AVCaptureDevice then counts as MICROPHONE use instead (the Microphone string is required), and no other binary is excused.
    "Camera": (
        re.compile(AV_CAPTURE_DEVICE + r"|AVCaptureSession|AVCaptureDeviceInput|AVCaptureVideoDataOutput|AVCapturePhotoOutput|UIImagePickerController"),
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
    # Apps linked for iOS 13 and later need the Always key; the legacy Peripheral key does not stand in for it.
    "Bluetooth": (re.compile(r"CBCentralManager|CBPeripheralManager"), ("NSBluetoothAlwaysUsageDescription",)),
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


def all_symbols(binary: Path) -> str:
    """Every symbol of the binary, defined and undefined: Expo's dev client is linked statically, so its classes are DEFINED in the
    main executable and never appear in `nm -u`."""
    result = subprocess.run(["nm", str(binary)], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"nm {binary.name} failed: {result.stderr.strip()[:200]}")
    return result.stdout


def has_string(info: dict, key: str) -> bool:
    value = info.get(key)
    return isinstance(value, str) and value.strip() != ""


def check(
    info: dict,
    symbols_by_binary: dict[str, str],
    *,
    production: bool = False,
    defined_by_binary: dict[str, str] | None = None,
    audio_only_capture_device: tuple[str, ...] | list[str] = (),
) -> tuple[list[str], list[str]]:
    """Returns (report lines, problems)."""
    report: list[str] = []
    problems: list[str] = []
    for framework, (pattern, keys) in SENSITIVE.items():
        users = {}
        for name, symbols in symbols_by_binary.items():
            # AVCaptureDevice is matched with its prefix; report it by its plain name.
            hits = sorted({"AVCaptureDevice" if AV_CAPTURE_DEVICE_RE.fullmatch(m.group(0)) else m.group(0) for m in pattern.finditer(symbols)})
            if name in audio_only_capture_device and AV_CAPTURE_DEVICE_RE.search(symbols):
                # Reviewed by hand: this binary asks AVCaptureDevice for the microphone only. That is microphone use, not camera use.
                if framework == "Camera":
                    hits = [hit for hit in hits if hit != "AVCaptureDevice"]
                elif framework == "Microphone":
                    hits = sorted(set(hits) | {"AVCaptureDevice (audio, by --audio-only-capture-device)"})
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
            hint = (
                " (AVCaptureDevice alone may be microphone-only use: if a dependency is reviewed to do only that, pass "
                "--audio-only-capture-device <its binary name>)"
                if framework == "Camera" and any("AVCaptureDevice" in hits for hits in users.values())
                else ""
            )
            problems.append(f"{framework} is linked ({where}) but Info.plist has none of {', '.join(keys)}{hint}")

    if production:
        # The dev client is in the binary that links it statically: look at every symbol, not only the undefined ones.
        everything = defined_by_binary if defined_by_binary is not None else symbols_by_binary
        for name, symbols in everything.items():
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
    parser.add_argument(
        "--audio-only-capture-device",
        action="append",
        default=[],
        metavar="BINARY",
        help="the named binary (e.g. ExpoFoo) was reviewed to use AVCaptureDevice for the microphone only; repeatable",
    )
    parser.add_argument("--symbols-from", type=Path, help="symbol list for every binary (tests)")
    args = parser.parse_args(argv)

    info = load_plist(args.app / "Info.plist")
    if args.symbols_from:
        symbols = {info.get("CFBundleExecutable", "app"): args.symbols_from.read_text()}
        everything = None
    else:
        found = binaries(args.app, info)
        symbols = {binary.name: undefined_symbols(binary) for binary in found}
        everything = {binary.name: all_symbols(binary) for binary in found}

    print(f"{info.get('CFBundleIdentifier')} {info.get('CFBundleShortVersionString')} ({info.get('CFBundleVersion')}): "
          f"{len(symbols)} binaries scanned")
    report, problems = check(
        info,
        symbols,
        production=args.production,
        defined_by_binary=everything,
        audio_only_capture_device=args.audio_only_capture_device,
    )
    for line in report:
        print(line)
    if not report:
        print("no privacy-sensitive framework is used")
    for problem in problems:
        print(f"::error::{problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
