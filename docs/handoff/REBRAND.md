# REBRAND: OpenEFB → Kanaf (dashboard T36)

Owner decisions:
- Q14 = B: the product is now **Kanaf** (Hebrew: **כנף**, "wing").
- Q15 = B: keep the GitHub fork (`omercnet/openefb`) and rebrand its contents.

The App Store Connect name is **"Kanaf EFB"**: plain "Kanaf" is taken on the App Store, so "Kanaf EFB" is claimed for app
6829641724. The home-screen and in-app name is **Kanaf**.

## Make it the owner's project, with credit
- **README.md:** rewrite it as Kanaf, the owner's project: what it is (a free, open-source iPad/iPhone VFR EFB for the US
  and Israel, CVFR), features, limitations, how to build, data credits.
  - Near the end, add a short, warm "Thanks" section: Kanaf began as a fork of **OpenEFB** by **Ryan Stern**
    (https://github.com/sternryan/openefb), with a line of genuine credit.
  - Don't present the original author's work as the owner's.
- **License:** the original code is MPL-2.0. Keep LICENSE and every existing MPL/copyright notice exactly as they are.
  Don't relicense or remove Ryan Stern's attribution from files that carry it. Add a NOTICE line: "Kanaf is a modified
  version of OpenEFB by Ryan Stern, MPL-2.0." New docs may say "© 2026 Omer Cohen and contributors" where the project
  states its own copyright; no file-header churn.

## Rename user-facing strings
`grep -rni openefb` across the repo, then classify each hit:
- **Change to Kanaf:**
  - the app display name (`INFOPLIST_KEY_CFBundleDisplayName`, both configurations);
  - onboarding, About, the beta banner, Send Feedback (subject/body), the disclaimers;
  - the Settings footers, the UI copy, accessibility labels, and any "OpenEFB" in Swift strings shown to users;
  - dist-prep (APP_STORE_METADATA with the name "Kanaf EFB", the subtitle and description, TESTFLIGHT.md, README,
    PRIVACY labels doc);
  - the docs (AGENTS.md header and overview, PRD.md header note, COMMON.md title lines, docs/*.md product name);
  - the web/interviews copy ("the Kanaf team", "אנחנו הצוות הקטן מאחורי Kanaf / כנף"; Hebrew may use כנף);
  - the relay's User-Agent string (an honest "Kanaf-NOTAM-relay/1.0 (+repo URL)");
  - the tool READMEs.
- **Keep, because it's internal or would break things:**
  - the Xcode target/scheme `efb-212` and the bundle ID `io.omer.efb`;
  - the test bundle IDs;
  - the R2 bucket `openefb-charts`, the Worker name `openefb-notam-relay` and its URL, the Vercel project
    `openefb-interviews` and its URL;
  - the GitHub repo URL `omercnet/openefb`;
  - the Swift type and file names;
  - KV and blob keys;
  - historical docs (docs/handoff/*.md briefs, beads history, research docs that quote the past: leave them, apart
    from current-state docs).
  In the README, describe the old names in one line: "internal identifiers still say openefb/efb-212".
- **Simulator naming** in tools/sim-test.sh ("OpenEFB · …"): leave it, because renaming orphans the pool simulators.

## Other
- GitHub repo metadata: set the description and topics with `gh repo edit omercnet/openefb --description "Kanaf, a free,
  open-source VFR EFB for iPad and iPhone (US + Israel CVFR)" --add-topic …`. Don't rename the repo.
- The app icon stays.

## Verify
- `grep -rni openefb` leaves only the "keep" categories. List them in your report, grouped.
- Full unit suite green; update tests that assert user-visible "OpenEFB" strings.
- interviews `npm run lint && npm run build`; relay `npm test`. Redeploy the relay (`npx wrangler deploy` in
  web/notam-relay; wrangler is logged in) and check `/health`. Don't deploy interviews; it deploys on push.
- Screenshots of onboarding, About and the home-screen label in docs/design/screenshots/REBRAND/.

## Coordination
Another agent (T35, Israel flight simulation) is editing MapContainerView, LocationService, tools/fly.sh,
tools/sim-test.sh and the Build & Run section of AGENTS.md. Re-read any shared file right before editing it, and change
only the name strings there. Don't touch dist-prep/upload-testflight.sh or ExportOptions.plist. Follow
docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim BRAND)` and release it). Don't
commit.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T36 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
