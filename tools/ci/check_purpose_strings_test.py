#!/usr/bin/env python3
"""python3 tools/ci/check_purpose_strings_test.py : the purpose-string check against fake symbol lists and Info.plist dicts."""
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import check_purpose_strings as c  # noqa: E402

BASE = {
    "CFBundleExecutable": "KanafEFB",
    "CFBundleIdentifier": "io.omer.efb",
    "CFBundleShortVersionString": "1.4.0",
    "CFBundleVersion": "159",
    "NSLocationWhenInUseUsageDescription": "location",
    "NSMicrophoneUsageDescription": "mic",
    "NSSpeechRecognitionUsageDescription": "speech",
}
# Symbols as `nm -u` prints them: Objective-C classes, and Swift's mangled references.
OBJC = "_OBJC_CLASS_$_CLLocationManager\n_OBJC_CLASS_$_AVAudioRecorder\n_OBJC_CLASS_$_NSString\n"
SWIFT_PHOTOS = "_$sSo14PHPhotoLibraryC21authorizationStatusforSo0aB8StatusVSo0aB11AccessLevelV_tFZ\n"


def run(info, symbols, production=False):
    return c.check(info, {"KanafEFB": symbols}, production=production)


class PurposeStrings(unittest.TestCase):
    def test_the_apps_own_apis_have_their_strings(self):
        report, problems = run(BASE, OBJC + "_OBJC_CLASS_$_SFSpeechRecognizer\n")
        self.assertEqual(problems, [])
        self.assertEqual(len(report), 3)  # Location, Microphone, Speech

    def test_photos_without_a_string_is_the_failure_apple_gave_us(self):
        report, problems = run(BASE, OBJC + SWIFT_PHOTOS)
        self.assertEqual(len(problems), 1)
        self.assertIn("Photos is linked", problems[0])
        self.assertIn("NSPhotoLibraryUsageDescription", problems[0])
        self.assertTrue(any(line.startswith("FAIL Photos") for line in report))

    def test_photos_with_the_string_passes_and_either_key_counts(self):
        for key in ("NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"):
            _, problems = run({**BASE, key: "Kanaf reads a photo only when you hand one over."}, SWIFT_PHOTOS)
            self.assertEqual(problems, [], key)

    def test_an_empty_or_non_string_value_is_no_string(self):
        for value in ("", "   ", None, 5, ["x"]):
            _, problems = run({**BASE, "NSPhotoLibraryUsageDescription": value}, SWIFT_PHOTOS)
            self.assertEqual(len(problems), 1, repr(value))

    def test_every_listed_framework_is_detected_by_a_class_and_needs_its_key(self):
        cases = {
            "Photos": "_OBJC_CLASS_$_PHAsset",
            "Camera": "_OBJC_CLASS_$_AVCaptureSession",
            "Contacts": "_OBJC_CLASS_$_CNContactStore",
            "Microphone": "_OBJC_CLASS_$_AVAudioRecorder",
            "Speech": "_OBJC_CLASS_$_SFSpeechRecognizer",
            "Bluetooth": "_OBJC_CLASS_$_CBCentralManager",
            "Motion": "_OBJC_CLASS_$_CMMotionActivityManager",
            "Location": "_OBJC_CLASS_$_CLLocationManager",
        }
        self.assertEqual(set(cases), set(c.SENSITIVE))
        for framework, symbol in cases.items():
            _, problems = c.check({"CFBundleExecutable": "x"}, {"x": symbol + "\n"})
            self.assertEqual(len(problems), 1, framework)
            self.assertIn(f"{framework} is linked", problems[0])
            keys = c.SENSITIVE[framework][1]
            _, ok = c.check({"CFBundleExecutable": "x", keys[0]: "why"}, {"x": symbol + "\n"})
            self.assertEqual(ok, [], framework)

    def test_raw_motion_sensors_need_no_string_but_activity_data_does(self):
        # reanimated links CMMotionManager (accelerometer, gyroscope): no permission exists for it.
        _, problems = run(BASE, OBJC + "_OBJC_CLASS_$_CMMotionManager\n")
        self.assertEqual(problems, [])
        for symbol in ("CMMotionActivityManager", "CMPedometer", "CMAltimeter"):
            _, problems = run(BASE, OBJC + f"_OBJC_CLASS_$_{symbol}\n")
            self.assertEqual(len(problems), 1, symbol)
            self.assertIn("Motion is linked", problems[0])

    def test_the_message_names_the_binary_that_uses_the_class(self):
        _, problems = c.check(BASE, {"KanafEFB": OBJC, "Pods.framework": SWIFT_PHOTOS})
        self.assertIn("Pods.framework: PHPhotoLibrary", problems[0])

    def test_production_refuses_a_development_client(self):
        dev = {
            **BASE,
            "NSBonjourServices": ["_expo._tcp"],
            "CFBundleURLTypes": [{"CFBundleURLSchemes": ["kanaf", "io.omer.efb"]}, {"CFBundleURLSchemes": ["exp+kanaf"]}],
        }
        _, problems = run(dev, OBJC + "_OBJC_CLASS_$_EXDevLauncherController\n", production=True)
        text = "\n".join(problems)
        self.assertIn("development client code", text)
        self.assertIn("NSBonjourServices", text)
        self.assertIn("exp+kanaf", text)
        _, quiet = run(dev, OBJC + "_OBJC_CLASS_$_EXDevLauncherController\n", production=False)
        self.assertEqual(quiet, [])  # only a production build is held to it

    def test_avcapturedevice_alone_counts_as_camera_use_unless_the_binary_is_allowed_by_hand(self):
        # The symbol list cannot tell the camera from the microphone, so the safe reading is camera (a missing string crashes the app
        # when it asks for the camera); a reviewed microphone-only binary is allowed by NAME, and nothing else is.
        symbols = OBJC + "_OBJC_CLASS_$_AVCaptureDevice\n"
        _, problems = run(BASE, symbols)
        self.assertEqual(len(problems), 1)
        self.assertIn("Camera is linked", problems[0])
        self.assertIn("--audio-only-capture-device <its binary name>", problems[0])
        _, allowed = c.check(BASE, {"KanafEFB": symbols}, audio_only_capture_device=["KanafEFB"])
        self.assertEqual(allowed, [])  # the microphone string (BASE has it) covers the reclassified use
        # a different binary with the camera symbol is not excused by naming this one
        _, other = c.check(BASE, {"KanafEFB": OBJC, "Other": symbols}, audio_only_capture_device=["KanafEFB"])
        self.assertEqual(len(other), 1)
        self.assertIn("Other: AVCaptureDevice", other[0])

    def test_the_allowance_turns_avcapturedevice_into_microphone_use_that_needs_its_string(self):
        symbols = "_OBJC_CLASS_$_AVCaptureDevice\n"
        info = {"CFBundleExecutable": "x"}
        _, problems = c.check(info, {"x": symbols}, audio_only_capture_device=["x"])
        self.assertEqual(len(problems), 1)
        self.assertIn("Microphone is linked", problems[0])
        self.assertIn("NSMicrophoneUsageDescription", problems[0])
        _, ok = c.check({**info, "NSMicrophoneUsageDescription": "why"}, {"x": symbols}, audio_only_capture_device=["x"])
        self.assertEqual(ok, [])

    def test_the_allowance_does_not_excuse_a_session_next_to_avcapturedevice(self):
        symbols = "_OBJC_CLASS_$_AVCaptureDevice\n_OBJC_CLASS_$_AVCaptureSession\n"
        _, problems = c.check({"CFBundleExecutable": "x", "NSMicrophoneUsageDescription": "why"}, {"x": symbols}, audio_only_capture_device=["x"])
        self.assertEqual(len(problems), 1)
        self.assertIn("Camera is linked", problems[0])
        self.assertIn("AVCaptureSession", problems[0])

    def test_avcapturedeviceinput_is_not_avcapturedevice_in_either_symbol_form(self):
        # Objective-C and Swift-mangled references to the longer class must not read as the plain class, so the allowance cannot hide them.
        for symbol in ("_OBJC_CLASS_$_AVCaptureDeviceInput", "_$sSo22AVCaptureDeviceInputCMa"):
            _, problems = c.check({"CFBundleExecutable": "x", "NSMicrophoneUsageDescription": "why"}, {"x": symbol + "\n"}, audio_only_capture_device=["x"])
            self.assertEqual(len(problems), 1, symbol)
            self.assertIn("Camera is linked", problems[0])
        for symbol in ("_OBJC_CLASS_$_AVCaptureDevice", "_$sSo15AVCaptureDeviceCMa"):
            hit, _ = c.check({"CFBundleExecutable": "x"}, {"x": symbol + "\n"})
            self.assertIn("AVCaptureDevice", hit[0], symbol)
            self.assertNotIn("AVCaptureDeviceInput", hit[0], symbol)

    def test_camera_needs_its_string_for_a_session_or_the_picker(self):
        for symbol in ("AVCaptureSession", "UIImagePickerController", "AVCapturePhotoOutput"):
            _, problems = run(BASE, OBJC + f"_OBJC_CLASS_$_{symbol}\n")
            self.assertEqual(len(problems), 1, symbol)
            self.assertIn("Camera is linked", problems[0])
            _, ok = run({**BASE, "NSCameraUsageDescription": "why"}, OBJC + f"_OBJC_CLASS_$_{symbol}\n")
            self.assertEqual(ok, [], symbol)

    def test_bluetooth_needs_the_always_key_not_the_legacy_one(self):
        symbols = OBJC + "_OBJC_CLASS_$_CBCentralManager\n"
        _, legacy = run({**BASE, "NSBluetoothPeripheralUsageDescription": "legacy"}, symbols)
        self.assertEqual(len(legacy), 1)
        self.assertIn("NSBluetoothAlwaysUsageDescription", legacy[0])
        _, modern = run({**BASE, "NSBluetoothAlwaysUsageDescription": "why"}, symbols)
        self.assertEqual(modern, [])

    def test_a_statically_linked_dev_client_is_found_in_the_defined_symbols(self):
        # Static layout: the executable DEFINES the dev launcher's classes (nm prints them with a type letter, no `U`), and the
        # undefined list has nothing of them. The production check must still fail.
        undefined = {"KanafEFB": OBJC}
        defined = {
            "KanafEFB": OBJC
            + "0000000100a1b2c0 S _OBJC_CLASS_$_EXDevLauncherController\n0000000100a1b2d0 T _$s16EXDevMenuManagerCMa\n"
        }
        _, problems = c.check(BASE, undefined, production=True, defined_by_binary=defined)
        self.assertEqual(len(problems), 1)
        self.assertIn("EXDevLauncher", problems[0])
        _, clean = c.check(BASE, undefined, production=True, defined_by_binary={"KanafEFB": OBJC + "0000000100a1b2c0 S _OBJC_CLASS_$_RCTDevMenu\n"})
        self.assertEqual(clean, [])
        _, development = c.check(BASE, undefined, defined_by_binary=defined)
        self.assertEqual(development, [])

    def test_the_behaviour_selectors_are_keyword_only(self):
        # A positional allowlist used to land in the wrong slot and be ignored (or crash); now it cannot be passed that way.
        with self.assertRaises(TypeError):
            c.check(BASE, {"KanafEFB": OBJC}, True)
        with self.assertRaises(TypeError):
            c.check(BASE, {"KanafEFB": OBJC}, False, None, ["KanafEFB"])

    def test_react_native_core_dev_menu_is_not_the_development_client(self):
        # RN links RCTDevMenu and RCTDevSettings in every build; the first CI run matched a bare "DevMenu" and failed on them.
        _, problems = run(BASE, OBJC + "_OBJC_CLASS_$_RCTDevMenu\n_OBJC_CLASS_$_RCTDevSettings\n_OBJC_CLASS_$_RCTDevLoadingView\n", production=True)
        self.assertEqual(problems, [])
        _, problems = run(BASE, OBJC + "_OBJC_CLASS_$_EXDevMenuManager\n", production=True)
        self.assertIn("EXDevMenu", problems[0])

    def test_a_clean_production_app_passes(self):
        info = {**BASE, "CFBundleURLTypes": [{"CFBundleURLSchemes": ["kanaf", "io.omer.efb"]}]}
        _, problems = run(info, OBJC, production=True)
        self.assertEqual(problems, [])

    def test_the_command_line_over_a_fake_app(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp) / "KanafEFB.app"
            app.mkdir()
            with (app / "Info.plist").open("wb") as handle:
                plistlib.dump(BASE, handle)
            symbols = Path(tmp) / "symbols.txt"
            symbols.write_text(OBJC + SWIFT_PHOTOS)
            script = str(Path(__file__).parent / "check_purpose_strings.py")
            failed = subprocess.run([sys.executable, script, str(app), "--symbols-from", str(symbols)], capture_output=True, text=True)
            self.assertEqual(failed.returncode, 1)
            self.assertIn("::error::Photos is linked", failed.stdout)
            with (app / "Info.plist").open("wb") as handle:
                plistlib.dump({**BASE, "NSPhotoLibraryUsageDescription": "why"}, handle)
            passed = subprocess.run([sys.executable, script, str(app), "--symbols-from", str(symbols)], capture_output=True, text=True)
            self.assertEqual(passed.returncode, 0, passed.stdout)


if __name__ == "__main__":
    unittest.main()
