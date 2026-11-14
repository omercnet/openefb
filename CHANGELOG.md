# Changelog

## [1.4.0](https://github.com/omercnet/openefb/compare/v1.3.0...v1.4.0) (2026-11-13)


### Features

* **adapters:** on-device AI debrief and first-party usage counters (A6, A5) ([#49](https://github.com/omercnet/openefb/issues/49)) ([b773d38](https://github.com/omercnet/openefb/commit/b773d38ba8467773f09698122e6cd871e02054f2))
* **adapters:** recording files, replay audio, airport lookup and speech transcription (A7, A3) ([#46](https://github.com/omercnet/openefb/issues/46)) ([b03a2ce](https://github.com/omercnet/openefb/commit/b03a2cebefd05d6626e92788cae9a12cb7c0966b))
* **adapters:** SecretStore, location, audio recorder (A4, A1, A2) ([#27](https://github.com/omercnet/openefb/issues/27)) ([79d2941](https://github.com/omercnet/openefb/commit/79d294169ca27e256fb9a77011cf290a879a4035))
* **app:** offer the iPad app on Apple Silicon Macs and Vision Pro ([#21](https://github.com/omercnet/openefb/issues/21)) ([70b3633](https://github.com/omercnet/openefb/commit/70b3633941ea0a5529206869e5239d158b256324))
* **app:** rewrite foundation F1-F3 (app/ promotion, tooling, skeleton) ([#25](https://github.com/omercnet/openefb/issues/25)) ([7851707](https://github.com/omercnet/openefb/commit/7851707813acf9c187cc0f419c41084bb02bd444))
* **data:** aviation database access, versioned install and spatial queries (D5, 1/2) ([#32](https://github.com/omercnet/openefb/issues/32)) ([8e67551](https://github.com/omercnet/openefb/commit/8e675514a8954713858e8aeff43ec4201171329b))
* **data:** Israel aviation database access (D5, 2/2) ([#36](https://github.com/omercnet/openefb/issues/36)) ([f8033e4](https://github.com/omercnet/openefb/commit/f8033e478a8ac5873553f836a141db721ff50e1c))
* **data:** SQLite schema, repositories, expo-sqlite Db and recording database (D2, D4) ([#31](https://github.com/omercnet/openefb/issues/31)) ([aa41feb](https://github.com/omercnet/openefb/commit/aa41feb276210b107648bf98d0af6aacd30a8afe))
* **domain:** Israel rules, route following, planner, closure mapper, briefing filter, alerts (L3) ([#42](https://github.com/omercnet/openefb/issues/42)) ([c55e5a9](https://github.com/omercnet/openefb/commit/c55e5a96d3f085bafeb4d03f6e450304fd759b17))
* **domain:** port core, route and prediction (L1, L2, L7) ([#30](https://github.com/omercnet/openefb/issues/30)) ([63dc68a](https://github.com/omercnet/openefb/commit/63dc68a5f51c38b124671594fd3673830798faac))
* **domain:** port flight persistence and recovery (L4 part 2) ([#41](https://github.com/omercnet/openefb/issues/41)) ([94b0f68](https://github.com/omercnet/openefb/commit/94b0f6814412205975e7d03832681e34f1528abe))
* **domain:** port replay, currency, recording logic and debrief (L8, L6, L4 part 1, L5) ([#35](https://github.com/omercnet/openefb/issues/35)) ([c408b31](https://github.com/omercnet/openefb/commit/c408b31c45438de145e59960a4fd78fc9603a83d))
* **map:** airport diagram overlay and PDF chart viewer over the S1c chart pack (M4) ([#55](https://github.com/omercnet/openefb/issues/55)) ([bd9575d](https://github.com/omercnet/openefb/commit/bd9575d302550e7d521cddbcae2517762d7e720f))
* **map:** Israel overlays, per-region layer registry, layer overrides (M1) ([#52](https://github.com/omercnet/openefb/issues/52)) ([63b5097](https://github.com/omercnet/openefb/commit/63b5097e8cabc056253b879c9a01b192b804633c))
* **map:** map surface, layer registry, data controller, follow and camera (M1, M2) ([#44](https://github.com/omercnet/openefb/issues/44)) ([bce802d](https://github.com/omercnet/openefb/commit/bce802d328c0676cc517faab3a8431b832e0ac31))
* **map:** offline map packs and bundled glyphs for offline labels (M3) ([#53](https://github.com/omercnet/openefb/issues/53)) ([c12377a](https://github.com/omercnet/openefb/commit/c12377a8ebd0dad25487d127f66162be747542b2))
* **rn:** React Native spike, self-hosted OTA server and rewrite plan ([#22](https://github.com/omercnet/openefb/issues/22)) ([fd205ff](https://github.com/omercnet/openefb/commit/fd205ff708d352685cb4bfa64d53d12adf926d6b))
* **services:** chart packs, airport diagram georeferencing and terminal procedures (S1c) ([#51](https://github.com/omercnet/openefb/issues/51)) ([a5da55e](https://github.com/omercnet/openefb/commit/a5da55e8e14a460d2c2cdcb6e8e43114059ced27))
* **services:** data refresh, remote config, NOTAM and Air/SIGMET services (S1a, S1b) ([#43](https://github.com/omercnet/openefb/issues/43)) ([958fa5d](https://github.com/omercnet/openefb/commit/958fa5d4236d765ee23743d631d0b90e3b15e075))
* **services:** weather, TFR, PIREP, winds aloft, proximity and Israel alerts, reachability (S1d, S1e) ([#54](https://github.com/omercnet/openefb/issues/54)) ([4ebbcb2](https://github.com/omercnet/openefb/commit/4ebbcb23f4ec3e88192e0d4d9bdca62ab8846ef5))
* **ui:** iPhone rail layout with the compact strip pieces (U5) ([#59](https://github.com/omercnet/openefb/issues/59)) ([004e10c](https://github.com/omercnet/openefb/commit/004e10c381d3662a779d74d2aba35797eb43ef1f))
* **ui:** Israel briefing and flight plan sheets, FPL to the IAA (U4b part 2) ([#58](https://github.com/omercnet/openefb/issues/58)) ([583b7f2](https://github.com/omercnet/openefb/commit/583b7f2efdfc9c2e7e920a5c35a76a32d6c5d6f4))
* **ui:** Nearest and Search columns and the Log screen (U4a) ([#50](https://github.com/omercnet/openefb/issues/50)) ([0034f95](https://github.com/omercnet/openefb/commit/0034f956000dc587c02d40173fb76e61f524d99b))
* **ui:** port aircraft and pilot profiles, logbook entry and currency screens (U7b) ([#60](https://github.com/omercnet/openefb/issues/60)) ([73b5806](https://github.com/omercnet/openefb/commit/73b5806a771d0b5f83cb68f76855a63d60879106))
* **ui:** port flight detail, AI debrief and CVFR section (U8b debrief) ([#62](https://github.com/omercnet/openefb/issues/62)) ([c06c59f](https://github.com/omercnet/openefb/commit/c06c59fbf49dacf2953ace677538d565b1457a68))
* **ui:** port Settings, Onboarding and Disclaimers screens (U7a) ([#45](https://github.com/omercnet/openefb/issues/45)) ([fcf3609](https://github.com/omercnet/openefb/commit/fcf3609135e9b25af6d1d406d5b26b38348240af))
* **ui:** port the recording controls and the replay screen (U8a, U8b replay) ([#61](https://github.com/omercnet/openefb/issues/61)) ([6f12392](https://github.com/omercnet/openefb/commit/6f1239222b2f7eee4a0751fbf633f9801235934d))
* **ui:** production airport column with weather (U4b part 1) ([#56](https://github.com/omercnet/openefb/issues/56)) ([8335452](https://github.com/omercnet/openefb/commit/83354520517a2686bd6330254b7ac435e1c3f0bc))
* **ui:** production flight log strip, footer and Layers column (U3) ([#47](https://github.com/omercnet/openefb/issues/47)) ([5136cd5](https://github.com/omercnet/openefb/commit/5136cd5e364e0476e9a02fda36e08bb8d586b5b8))
* **ui:** tokens audit, components, display mode (U1) and airport column rows (U2) ([#38](https://github.com/omercnet/openefb/issues/38)) ([cc349e7](https://github.com/omercnet/openefb/commit/cc349e7e3afa2c21b28a806e97b7aeaaf64ce1d1))


### Bug Fixes

* **services:** show See NOTAM when a changed TFR NOTAM's detail refetch fails (Q10) ([#65](https://github.com/omercnet/openefb/issues/65)) ([ee923e8](https://github.com/omercnet/openefb/commit/ee923e88d6912e081763b38fc452f89fbe565689))
* **ui:** full-width U7/U8 screens with large titles; recording captures on the map screen ([#66](https://github.com/omercnet/openefb/issues/66)) ([673462a](https://github.com/omercnet/openefb/commit/673462a08b86ae44d5be0256eb9caa1259b3ecf3))

## [1.3.0](https://github.com/omercnet/openefb/compare/v1.2.0...v1.3.0) (2026-11-08)


### Features

* **map:** Direction 2 stage 1, the flight log strip ([#13](https://github.com/omercnet/openefb/issues/13)) ([08df310](https://github.com/omercnet/openefb/commit/08df3100cd4a895b04dacca8cc6b0bcceb79e4d4))
* **map:** Direction 2 stage 2, predicted airspace ahead and unrolled debrief ([#18](https://github.com/omercnet/openefb/issues/18)) ([ecf2805](https://github.com/omercnet/openefb/commit/ecf28059c78b81d4f1814e8e08d7fd9633043205))

## [1.2.0](https://github.com/omercnet/openefb/compare/v1.1.0...v1.2.0) (2026-11-07)


### Features

* **telemetry:** anonymous usage signals and MetricKit crash summaries via TelemetryDeck ([#15](https://github.com/omercnet/openefb/issues/15)) ([9d74151](https://github.com/omercnet/openefb/commit/9d741512870fed851f17165c1245085f3da5fd1c))


### Bug Fixes

* **release:** keep decrypted TestFlight crash logs private (umask 077) ([#17](https://github.com/omercnet/openefb/issues/17)) ([c2a587a](https://github.com/omercnet/openefb/commit/c2a587a25eabe059f148a4f97af7036c2aee0fd6))
* **release:** plain-text What to Test notes for TestFlight ([#11](https://github.com/omercnet/openefb/issues/11)) ([cf14942](https://github.com/omercnet/openefb/commit/cf14942766e06853d45baaf62a477e5f1fa68b97))

## [1.1.0](https://github.com/omercnet/openefb/compare/v1.0.0...v1.1.0) (2026-11-05)


### Features

* **ui:** Kanaf look follow-ups: named colours, solid panels, north marker, docs ([#8](https://github.com/omercnet/openefb/issues/8)) ([4a120d1](https://github.com/omercnet/openefb/commit/4a120d11c6dfcd7f18659358503ed67f05a856a6))
* **ui:** Kanaf navy look with shared color, radius and type tokens ([#5](https://github.com/omercnet/openefb/issues/5)) ([f131e41](https://github.com/omercnet/openefb/commit/f131e414c5e962045d669a8fb8aa896370c504fc))


### Bug Fixes

* **ci:** retry app liveness check in flight scenarios and fix summary printf ([#7](https://github.com/omercnet/openefb/issues/7)) ([b3be23e](https://github.com/omercnet/openefb/commit/b3be23ef06749848fd3e334b2611aa07d5b9ecdb))
