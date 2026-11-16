#!/usr/bin/env python3
"""python3 tools/ci/release_runner_test.py : which runner and Xcode the TestFlight job gets, for every event x app x variable.

The three expressions are read from .github/workflows/release.yml itself (the job's `runs-on`, its `DEVELOPER_DIR`, and the
`TESTFLIGHT_APP` of the "Choose the app" step) and evaluated with GitHub's rules for the operators they use (`&&` and `||` return
an operand, an empty string is false, `==` and `!=` compare strings). So the table tests what the workflow says, and the runner
cannot drift from the app the job builds.
"""
import itertools
import re
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/release.yml"


def expression(text: str) -> str:
    match = re.fullmatch(r"\s*\$\{\{(.*)\}\}\s*", text, re.S)
    assert match, f"not a ${{{{ }}}} expression: {text!r}"
    return match.group(1).strip()


def evaluate(expr: str, event: str, app_input: str, variable: str):
    """GitHub expression -> Python: `&&` is `and`, `||` is `or` (both return an operand, '' is falsy, as in GitHub)."""
    if not re.fullmatch(r"[\w\s.'/&|=!()\-]*", expr):
        raise AssertionError(f"unexpected characters in {expr!r}")
    python = expr.replace("&&", " and ").replace("||", " or ")
    python = python.replace("github.event_name", "EVENT").replace("inputs.app", "APP").replace("vars.TESTFLIGHT_APP", "VAR")
    return eval(python, {"__builtins__": {}}, {"EVENT": event, "APP": app_input, "VAR": variable})  # noqa: S307


def workflow_lines():
    return WORKFLOW.read_text().split("\n")


def find(prefix: str) -> str:
    """The value after `prefix` on the one line of the TestFlight job that starts with it."""
    start = next(i for i, line in enumerate(workflow_lines()) if line.startswith("  testflight:"))
    for line in workflow_lines()[start:]:
        stripped = line.strip()
        if stripped.startswith(prefix):
            return stripped[len(prefix):].strip()
    raise AssertionError(f"{prefix!r} not found in the testflight job")


RUNS_ON = expression(find("runs-on:"))
DEVELOPER_DIR = expression(find("DEVELOPER_DIR:"))
APP = expression(find("TESTFLIGHT_APP:"))

# (event, `app` input, vars.TESTFLIGHT_APP) -> the app that is built. Push runs have no inputs: `app` is ''.
CASES = {
    ("push", "", ""): "swift",
    ("push", "", "swift"): "swift",
    ("push", "", "rn"): "rn",
    ("workflow_dispatch", "variable", ""): "swift",
    ("workflow_dispatch", "variable", "swift"): "swift",
    ("workflow_dispatch", "variable", "rn"): "rn",
    ("workflow_dispatch", "swift", ""): "swift",
    ("workflow_dispatch", "swift", "rn"): "swift",
    ("workflow_dispatch", "rn", ""): "rn",
    ("workflow_dispatch", "rn", "swift"): "rn",
    ("workflow_dispatch", "rn", "rn"): "rn",
}
RUNNER = {"swift": "macos-26", "rn": "macos-latest"}
XCODE = {
    "swift": "/Applications/Xcode_26.6.app/Contents/Developer",
    "rn": "/Applications/Xcode.app/Contents/Developer",
}


def chosen_app(event, app_input, variable) -> str:
    """The app the "Choose the app" step builds: its TESTFLIGHT_APP, empty meaning swift (the step's case)."""
    value = evaluate(APP, event, app_input, variable) or "swift"
    assert value in ("swift", "rn"), value
    return value


class ReleaseRunner(unittest.TestCase):
    def test_the_table_of_runner_and_xcode_per_event_app_and_variable(self):
        for (event, app_input, variable), app in CASES.items():
            with self.subTest(event=event, app=app_input, variable=variable):
                self.assertEqual(chosen_app(event, app_input, variable), app)
                self.assertEqual(evaluate(RUNS_ON, event, app_input, variable), RUNNER[app])
                self.assertEqual(evaluate(DEVELOPER_DIR, event, app_input, variable), XCODE[app])

    def test_the_runner_always_follows_the_app_that_is_built(self):
        # Every combination, not only the table: the runner can never disagree with the "Choose the app" step.
        for event, app_input, variable in itertools.product(
            ("push", "workflow_dispatch"), ("", "variable", "swift", "rn"), ("", "swift", "rn")
        ):
            if event == "push" and app_input:
                continue  # a push has no inputs
            if event == "workflow_dispatch" and not app_input:
                continue  # a manual run always has the `app` input (default `variable`)
            app = chosen_app(event, app_input, variable)
            with self.subTest(event=event, app=app_input, variable=variable):
                self.assertEqual(evaluate(RUNS_ON, event, app_input, variable), RUNNER[app])
                self.assertEqual(evaluate(DEVELOPER_DIR, event, app_input, variable), XCODE[app])

    def test_the_swift_lane_keeps_macos_26_with_xcode_26_6_and_only_rn_leaves_it(self):
        self.assertEqual(RUNNER["swift"], "macos-26")
        for event, app_input, variable in CASES:
            if chosen_app(event, app_input, variable) == "swift":
                self.assertEqual(evaluate(RUNS_ON, event, app_input, variable), "macos-26")
                self.assertIn("Xcode_26.6", evaluate(DEVELOPER_DIR, event, app_input, variable))

    def test_the_rn_runner_and_xcode_are_the_ones_the_pr_time_archive_job_uses(self):
        app_yml = (WORKFLOW.parent / "app.yml").read_text()
        job = app_yml[app_yml.index("  ios-release-archive:"):]
        job = job[: job.index("\n  android:")]
        self.assertIn("runs-on: macos-latest", job)
        self.assertIn(f"DEVELOPER_DIR: {XCODE['rn']}", job)

    def test_the_job_has_no_other_runs_on_that_could_bypass_the_selection(self):
        start = next(i for i, line in enumerate(workflow_lines()) if line.startswith("  testflight:"))
        runs_on = [line for line in workflow_lines()[start:] if line.strip().startswith("runs-on:")]
        self.assertEqual(len(runs_on), 1)


if __name__ == "__main__":
    unittest.main()
