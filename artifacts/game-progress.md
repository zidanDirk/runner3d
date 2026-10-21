# Runner3D Task13 in progress

Original Task13 spec: attachment 2f066d2e-2f1f-435b-b9e1-63e1d9bcd6bb/Pasted text.txt. Product UI implementation is complete; final browser/visual/performance acceptance is NOT yet complete. No physics/economic/model changes.

Implemented: App home/playing/paused/results and one mutually exclusive native dialog panel via pure navigation reducer; lightweight true Idle character preview vs game Canvas; first-visit nonblocking three-step guidance done/skipped persistence; three free clothing skins with isolated materials and same GLB; central shop/missions/settings; results derived from before-profile+real lastSettlement; confirmed abandonment retires without wallet payment; actual menu input lock separate from graphics/audio lock. GameSession owns game RAF/city/inputs only while game visible. Loading during blur/hidden cancels automatic start. Keyboard dialog protection and node test guard.

Workers: product_state owns new product-helpers/spec/visual/video and production product tests, currently fixing worker-level video option split then9business/3visual; only this worker may run GPU. product_character owns performance spec/summarizer, waiting for GPU handoff. product_review finished read-only review and static old-test adaptation:22 old files+session-helpers, strict pass; no GPU.

Actual checks:451unit/40files passed (unit-phase3.log), strict passed; build-phase3.log pass (before latest input-lock tweak, finalbuild required later);15assets validate passed. Original before-source/before71PNG/hash and fivebefore-ui images preserved.

Actual first Desktop journey10checkpoints succeeded:177 legitimate earned+settled coins, magnet purchase100→77, distance mission40→117, second actual magnet9.9667s withLv1 config10s vsbase8, actual rendered cyan #32c5cf, refreshwallet117+skin/tutorial restored. However that Playwright attempt ultimately FAILED during video/trace teardown while another chat was simultaneously running fullsuite. Do not count it as passed. Failure/control-overlap images retained; trace large moved/tmp by worker. Final formal video stillpending.

User explicitly said another chat's full test suite should continue; did NOT stop it. It later exited itself (PID39728/port5174 freed). From now own Playwright output MUST isolate: PLAYWRIGHT_HTML_OUTPUT_DIR=test-results/task13/report and --output=test-results/task13/e2e. Do not clear/overwrite other chat defaulttest-results/e2e/playwright-report. Do not run concurrent GPU suites or --list.

Fixed from actual/review: nonrunning screen controls intercepted result homeclick→hidecontrols; desktop menu top+height could clip→centerwithinworld; delayed loading couldautostartbehindpage→cancelpending; mobilebuttons tutorial accidentallykeyboard→buttoncopy; submenu gameplaylock broke purchaseaudio→separatemenu/hardwarelocks+2units. Independent review no other confirmed settlement/appearance pollution defects.

Docs already added:docs/ui-ux-audit.md/ui-ux.md/navigation.md/onboarding.md, AGENTS Task13 section. Finalreport artifacts/ui-ux-evidence.md and files/finalchecks stillpending. expected-captures.json has20required states.

Next: finish9business+20realcaptures, rootdirectvisualreview, fixture960x666 actual fulljourneyvideo withfixedstepaccelerationsdisclosed, characterperformance6actualcycles; fullold+newE2E,71oldvisualcompare preserving actual/diff and onlyapproveintentionalupdates; finalbuild/production/loading, filesizeperformance/data/docs. Never delete tests, relax thresholds, fake wallet/over, or call mobile emulation realphones.
