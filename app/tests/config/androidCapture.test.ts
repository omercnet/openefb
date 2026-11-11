// scripts/android-capture.sh: the ANR dialog helpers (U3). On run 43111102990 a "Pixel Launcher isn't responding" dialog
// dimmed every screenshot (SSIM 0.51 to 0.58 against floors of 0.80 to 0.85). The helpers run here, as extracted from the
// script, against a fake `adb` whose window dump lists the ANR dialogs until the matching `am force-stop` is seen.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = fs.readFileSync(path.join(__dirname, '../../scripts/android-capture.sh'), 'utf8');

const FAKE_ADB = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_ADB_DIR/calls"
if [ "$1 $2" = "shell dumpsys" ]; then cat "$FAKE_ADB_DIR/windows"; exit 0; fi
if [ "$1 $2 $3" = "shell am force-stop" ]; then
  [ ! -f "$FAKE_ADB_DIR/stop-fails" ] || exit 1
  grep -vE "Application Not Responding: \${4//./\\\\.}[:}]" "$FAKE_ADB_DIR/windows" > "$FAKE_ADB_DIR/windows.next" || true
  mv "$FAKE_ADB_DIR/windows.next" "$FAKE_ADB_DIR/windows"
fi
`;

const STATUS_BAR = 'Window #1 Window{aa u0 StatusBar}:\r\n';
const launcherDialog =
  'Window #5 Window{7dc7add u0 Application Not Responding: com.google.android.apps.nexuslauncher}:\r\n';
const remoteDialog = 'Window #6 Window{7dc7ade u0 Application Not Responding: com.example.app:remote}:\r\n';
// The focus line of the same dialog: the package must be reported once.
const focusLine =
  '  mFocusedWindow=Window{7dc7add u0 Application Not Responding: com.google.android.apps.nexuslauncher}\r\n';

/** The text of a top-level shell function: `name() {` to the closing `}` in column 0. */
function shellFunction(name: string): string {
  const match = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}$`, 'm').exec(script);
  if (!match) throw new Error(`${name}() not found in android-capture.sh`);
  return match[0];
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-adb-'));
  fs.writeFileSync(path.join(dir, 'adb'), FAKE_ADB, { mode: 0o755 });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Run `commands` under the script's own `set -euo pipefail` with the helpers loaded and the fake adb first on PATH. */
function run(windows: string, commands: string, opts: { stopFails?: boolean } = {}) {
  fs.writeFileSync(path.join(dir, 'windows'), windows);
  if (opts.stopFails) fs.writeFileSync(path.join(dir, 'stop-fails'), '');
  const source = ['set -euo pipefail', shellFunction('anr_dialogs'), shellFunction('clear_anr_dialogs'), commands].join(
    '\n',
  );
  const result = spawnSync('bash', ['-c', source], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, FAKE_ADB_DIR: dir },
  });
  const calls = fs.existsSync(path.join(dir, 'calls'))
    ? fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n')
    : [];
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
}

describe('android-capture.sh ANR dialog helpers', () => {
  it('names the package of every ANR dialog once, without the carriage return or the process suffix', () => {
    const r = run(STATUS_BAR + launcherDialog + remoteDialog + focusLine, 'anr_dialogs');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('com.example.app\ncom.google.android.apps.nexuslauncher\n');
  });

  it('prints nothing and succeeds under set -e and pipefail when no dialog is up', () => {
    const r = run(STATUS_BAR, 'anr_dialogs');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('force-stops each package that has a dialog, says so, and leaves none up', () => {
    const r = run(STATUS_BAR + launcherDialog + remoteDialog, 'clear_anr_dialogs\necho "left: [$(anr_dialogs)]"');
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(
      expect.arrayContaining([
        'shell am force-stop com.example.app',
        'shell am force-stop com.google.android.apps.nexuslauncher',
      ]),
    );
    expect(r.stderr).toContain('dismissing the ANR dialog of com.example.app');
    expect(r.stderr).toContain('dismissing the ANR dialog of com.google.android.apps.nexuslauncher');
    expect(r.stdout.trim()).toBe('left: []');
  });

  it('kills nothing when no dialog is up', () => {
    const r = run(STATUS_BAR, 'clear_anr_dialogs');
    expect(r.status).toBe(0);
    expect(r.calls.filter((c) => c.includes('force-stop'))).toEqual([]);
  });

  it('keeps going when a force-stop fails', () => {
    const r = run(STATUS_BAR + launcherDialog + remoteDialog, 'clear_anr_dialogs\necho done', { stopFails: true });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('done');
    expect(r.calls.filter((c) => c.includes('force-stop'))).toHaveLength(2);
  });

  it('hides the system error dialogs before the install, the first heavy step', () => {
    const hide = script.indexOf('settings put global hide_error_dialogs 1');
    const install = script.indexOf('adb install');
    expect(hide).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(hide);
  });

  it('dismisses a dialog right before each capture and logs one that is still up', () => {
    const screenshot = shellFunction('screenshot');
    expect(screenshot.indexOf('clear_anr_dialogs')).toBeGreaterThan(-1);
    expect(screenshot.indexOf('clear_anr_dialogs')).toBeLessThan(screenshot.indexOf('screencap'));
    expect(screenshot.indexOf('anr_dialogs)')).toBeGreaterThan(screenshot.indexOf('screencap'));
  });
});
