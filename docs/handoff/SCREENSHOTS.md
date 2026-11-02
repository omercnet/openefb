# SCREENSHOTS: show the app in the README and docs (dashboard T15)

Read `docs/handoff/COMMON.md` first. Work in the main checkout, `/Users/omer/dev/openefb`. No other agents are running.
Don't commit; the integrator commits.

## Goal
The owner wants the screenshots that agents delivered on the Paseo dashboard to appear in the README and the relevant
docs. Today the README has no images at all.

## Input
`/tmp/deliverable-shots.tsv` has one line per delivered screenshot, with tab-separated columns: git status, ticket,
path, title.
- **Use only the `TRACKED` rows.**
- The 10 `NOT-IN-GIT` rows (`IL-9`, `IL-13`, the old `tools/caai-importer/docs/...` paths) show CAAI chart or diagram
  artwork, which stays out of git (`COMMON.md`). **Never reference, copy or commit them.**
- You may also use other tracked images under `docs/design/screenshots/` and `dist-prep/screenshots/` if they're better
  or newer for a spot.

## Rules
- **Look at every image before using it** (read the file).
  - Skip any image that shows the official CAAI CVFR chart raster or a CAAI aerodrome diagram (© CAAI / Mapa), even if
    it's tracked. List what you skipped.
  - Prefer the newest image that shows the current UI: the 3 tabs Map / Flights / Settings, the "Kanaf" name, no
    removed badge stack. Don't show outdated UI as current. If only an old image exists for a feature, leave that
    feature out rather than mislead.
- **README size:** the originals are large iPad and iPhone PNGs. For the README only, make resized JPEG copies in
  `docs/images/readme/`:
  - `sips -Z 1000 -s format jpeg -s formatOptions 75 <in> --out <out>`;
  - each under 300 KB, with short kebab-case names.

  Docs under `docs/` may link the originals by relative path.
- **README:** add a "Screenshots" section near the top, after the intro and before the long feature text. Use a compact
  HTML table of `<img width="...">` thumbnails, each with a one-line plain caption. Cover about 8–12 shots:
  - **US:** moving map with the sectional; airport sheet with METAR and its age badge; stale TFR marked OLD.
  - **Israel:** map with the CVFR overlay (not the official raster); auto-routed plan and FPL preview; NOTAM closures;
    route bar and an alert in flight; CVFR debrief; LSA route.
  - **iPhone:** map, and Direct-To.
  - **Recording:** the HUD error states, if current.
  - The app icon on the home screen.
- **Docs:** add the relevant images, with captions, where the text describes them:
  - `docs/design/IPHONE.md` (IPHONE);
  - `docs/RELIABILITY.md` (REL-FIX);
  - `docs/DESIGN.md` (the UX-IL before/after pairs, next to their findings);
  - `tools/flight-sim/README.md` (SIM-IL);
  - `docs/design/israel-border-buffers.md` (IL-ALERTS border);
  - `dist-prep/TESTFLIGHT.md`: only if a current image helps a tester.

  Use relative paths that render on GitHub. Don't rewrite the surrounding text beyond a caption line.
- Alt text describes what the image shows, for accessibility.
- No em dashes or Unicode arrows in new text; use `->`.

## Verify
- Every image path you added resolves:
  - list each one with `test -f`;
  - check it's tracked by git, or is a new file under `docs/images/readme/`.
- New files total under 4 MB, and `tools/check.sh --quick` passes. Its forbidden-files job blocks new files over 5 MB.
- Render the README locally to check the layout. `npx -y marked README.md > /tmp/readme.html`, opened in the browser
  tool, is fine. Take one screenshot of the Screenshots section and save it to `/tmp/readme-shot.png`. Don't commit it.

## Dashboard
- at each new stage: `cd /Users/omer/dev/openefb && paseo-progress ticket update T15 --stage <Build|Review|Verify>`
- between stages: `cd /Users/omer/dev/openefb && paseo-progress ticker set "<what you are doing now>"`

Never end your turn on an intention. Final reply: the files changed, the images used where, the images skipped and why,
and the verification results.
