# Browser suite budget and incomplete results

`verify-plugins.mjs` keeps automatic discovery of every repository plugin/browser
case and the existing explicit exclusions for unconfigured upstream PI fixtures.
The runner executes once, with a five-minute limit per test, concurrency one
on macOS and Windows and two on Linux. Desktop suites have 35 minutes within a
50-minute checks job; Linux retains its 20-minute suite budget. Browser CDP
requests retain their separate 20-second deadline. Functional assertions remain
mandatory, with no assertion retries or additional test exclusions.

## Current desktop budget evidence

[Release check 43363109456](https://github.com/ChengSoon/belfry-desktop/actions/runs/43363109456)
and [main check 43363109517](https://github.com/ChengSoon/belfry-desktop/actions/runs/43363109517)
tested `71d8cb976e39f6b1890b3a84166b16b10089336a`:

- Main macOS completed every check. Release macOS reached 342 assertions before
  the 30-minute browser deadline, retaining two earlier failures: a closed Chrome
  pipe and viewport-setup resize calls entering the drawer-operation counter.
- Both Windows browser runs passed 357 of 358 tests in roughly 870 seconds with
  two concurrent fixtures. They failed at different steps: deferred editor focus
  scrolled a reset button out of view, and a terminal fixture did not finish module
  initialization before readiness expired.

Windows now uses the same serial browser execution as macOS. The 35-minute suite
budget accommodates the remaining macOS cases, with 15 minutes outside that
budget for preparation, native checks, Node 20 compatibility and artifact upload.
The click helper waits for a stable target that receives the center hit, and
rescrolls when deferred focus moves it outside the viewport. The drawer test waits
for each terminal's viewport resize before counting drawer-operation resizes;
the existing operation bounds are unchanged. Disabled-option tests still send a
real pointer attempt while asserting that the option is disabled and visible.
These address separate observed causes; increased time alone cannot fix failures.

## Original budget evidence

[CI 42670683970](https://github.com/ChengSoon/belfry-desktop/actions/runs/42670683970)
tested `3769790e8a696dfd6b06ffbc55fcbef2042ac131` on both platforms:

| Platform | Before browser step | Browser result | Suite budget | Remaining within 45-minute job after measured preparation and budget |
| --- | --- | --- | --- | --- |
| macOS | 305 s | Killed at 20 minutes; 282 top-level cases completed, 281 passed and 1 failed; 293 assertions including nested tests; no final plan/summary | 30 min | 595 s (9 min 55 s) |
| Windows | 278 s | 302 top-level cases / 313 tests passed in 586.182 s | 20 min | 1,222 s (20 min 22 s) |

The macOS job's browser step lasted 1,202 seconds including launcher overhead;
the wrapper reported `spawnSync ETIMEDOUT`. Its observed case 251 also failed the
independent `73.484375 >= 80` layout assertion. More time does not fix that failure.
Windows's subsequent Node 20 setup/tests took 6/16 seconds, installer tests 10
seconds, and upload 4 seconds; macOS's failure artifact upload took 5 seconds.

The original 30-minute macOS budget reserved nearly ten minutes after preparation for
Node 20, upload and variation. It also accommodates T41's ten new startup cases,
including the intentional full 20-second no-response test. These are capacity
estimates, not a claim of a successful full macOS run. The next combined CI must
discover its actual files and finish all tests; no expected total such as 313 is
hardcoded. The desktop budget and enclosing job limit have since been adjusted
as described above.

## Result contract

The synchronous executor always reads the current invocation's TAP after the
child ends, including after timeout or signal termination. It reports the child
exit/signal/error, configured budgets, elapsed time, discovered file list, observed
top-level outcomes, nested assertion count, and final summary if available.
Earlier assertion failures remain listed even when the outer deadline is exceeded.
When the final plan is absent, remaining count is **unknown**, not zero; partial
observed counts are never presented as a final Node test total.

Success requires all of the following:

- A child exit of zero, without a spawn error or signal.
- A TAP header, one final root plan with consecutive matching results, and a full
  consistent Node summary. YAML diagnostic text is excluded from test counts.
- No failed/cancelled, skipped or TODO tests, and no TAP bailout. The previous skip
  detection is preserved alongside parsed result/summary checks.

A suite timeout exits 124; other child failures retain their positive exit code;
signals, missing/incomplete output and report-write failures exit nonzero. The
current TAP is preserved after execution. It is cleared before a new invocation
so a failed launch cannot validate an old successful result.

The human report goes to the console and `GITHUB_STEP_SUMMARY`, when configured.
The structured report is `plugin-suite-summary.json` under
`BELFRY_PANEL_ARTIFACTS`, already included in CI's artifact upload. Without that
directory it is written beside the TAP as `<outputPath>.summary.json`. Up to 32
failure labels are included in the summary; full diagnostics remain in the TAP.

## Lightweight regression

```sh
node --test --test-concurrency=1 .github/workflows/plugin-suite.case.mjs
```

This uses the current main Node runtime, as does the browser runner in CI. It
executes the real entry point against five tiny mandatory fixture files, then
checks real nested Node TAP, actual assertions/skips/TODOs, explicit exit codes,
signals, spawn failures, stale/truncated output and report-write failures. A
separate process writes a failed assertion then stays alive: a two-second test
budget verifies timeout reporting and retention without waiting 35 minutes.
The fixtures remove only the inherited `NODE_TEST_CONTEXT` recursive-run marker
before launching their independent test runner. They do not launch a browser.

The cases run in the existing early CI failure-propagation step. The budget case
also reads the enclosing workflow's limit and verifies preparation headroom on
both desktop platforms. Full Windows/macOS execution remains mandatory in the
combined release check.
