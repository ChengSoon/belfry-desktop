# Browser startup and pipe failures

`BrowserProcess` uses an isolated profile and Chrome's NUL-delimited CDP pipe. A
successful `Browser.getVersion` is followed by context creation, target creation,
attachment and, in order, `Runtime`, `Page`, `DOM`, `Accessibility`, `Console` enable.
The request deadline remains **20 seconds**. There is no automatic startup retry.

## Confirmed failure and scope

On source `b371a0013e6ae1e0c606d1b3d03f33bfa8c661b8`, an isolated protocol
consumer closed its response pipe at `Runtime.enable` while keeping its process
alive. The reader emitted `end`, but the process wrapper only watched incoming
data and write errors. `Runtime.enable` timed out 20 seconds later; disposal then
waited another 20 seconds on the same disconnected pipe.

Both protocol streams now report errors/closure; reader EOF immediately rejects
all in-flight requests with `BROWSER_CLOSED`. Subsequent disposal cannot send on
that ended connection. Explicit close also cancels pending requests. Cleanup waits
for the child's `close` event (including pipe handles), retains the existing one
second termination grace, then removes the profile. It records actual exit status,
forced termination and handle destruction. An underlying stream error remains the
error's `cause`; cleanup or diagnostic-write errors cannot replace the first
initialization error.

This confirms a pipe-disconnect bug, **not the cause of the original CI failure**.
T32 push `42667388095`, macOS job `129334580421`, failed at `Runtime.enable` on
`a47b0225967db2056d89d43e4bff24ce6f5035cb` (the relevant source is identical to
`b371a001`). That job has no stderr or protocol timeline. Its roughly 43-second
test duration alone cannot establish EOF, resource pressure or a common cause
with the separate session-input failure. A live connection with no response still
fails at its existing deadline. Its context disposal retains its own deadline;
only a known disconnected connection is rejected immediately.

## Reading a diagnostic

Initialization and unexpected transport failures attach `browserDiagnostics` to
the original error. With `BELFRY_PANEL_ARTIFACTS` set, they also write
`browser-startup/<node-pid>-<random-id>.json` under that directory. Existing CI
artifact upload already includes it; no workflow change is required. The initial
failure is saved **before** target disposal, and the same file is updated after
cleanup, so a later stall does not erase the first evidence. A write failure leaves
the in-memory snapshot and a bounded `artifactError` code on the original error.

| Field/event | Meaning |
| --- | --- |
| `firstFailure` | First reported failure, phase, safe code and in-flight request state at that instant |
| `state` | Latest process exit/signal, reader/writer status, pending requests, profile and child-handle cleanup |
| `request.send` / `request.written` | Request queued / handed to the OS pipe; neither proves the consumer replied |
| `response.ok` / `response.error` | Actual matched protocol response; errors retain the numeric CDP code |
| `request.timeout` | Existing request deadline expired, with measured elapsed time |
| `target.attached`, `protocol.event` | Target association and observed detach/crash/context lifecycle events |
| `read.end`, stream errors, `process.exit` / `process.close` | Distinguish EOF, I/O error, process exit and released pipe handles |
| `requests.cancelled`, `cleanup.*`, `profile.removed` | Cancellation and resource cleanup, including secondary errors |

Times are monotonic milliseconds since wrapper creation. Context/target/session
identifiers are salted hashes, consistent only within that browser instance.
Only initialization method names and a fixed lifecycle-event allowlist are kept;
other request methods are labelled `other`. Events never include request parameters,
page results, console text, expressions, URLs, titles or filesystem paths.

The trace retains the first 64 and most recent 96 events, with an omitted count.
Pending requests retain the existing maximum of 128. Stderr is drained throughout,
but only the first 16 KiB is inspected, with at most 24 classified lines and a
2,048-character partial-line buffer. It records severity, a fixed subsystem/category
and byte/inspected-line counts. **Stderr bodies and raw source headers are omitted**;
unknown text stays redacted. Classification is a clue, not a root-cause conclusion.

## Focused verification

```sh
node --test --test-concurrency=1 scripts/plugin-tests/browser-startup.case.mjs
node --test --test-concurrency=1 src/components/lazy/testing/panels.case.mjs
```

The startup cases use a real isolated browser for initialization/navigation and a
separate Node process for controlled pipe fragmentation, EOF, abnormal exit,
nonresponse, cancellation, stderr flooding and error preservation. Only executable
selection/spawn are substituted for the consumer; protocol transport, production
deadlines and cleanup remain real. Tests also cover spawn failure and unwritable
diagnostic destinations. They verify drained handles, no remaining pending requests,
profile deletion, and absence of payload/identifier canaries from artifacts.

Case evidence under `controlled-browser-startup/` is labelled by scenario; `real`
is the isolated Chrome case and the other scenarios are injected failures or the
protocol consumer. Such expected-failure test evidence is separate from the
`browser-startup/` files emitted by an unexpected application/fixture failure.
Node 20 and the main Node runtime run the same startup cases. Original panels and
browser interaction assertions remain unchanged; Windows execution is left to the
coordinator's next combined CI run.
