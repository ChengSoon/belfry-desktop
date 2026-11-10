# Room responsibility routing

The coordinator now receives the current responsibility roster with each room
message, including completion and idle notices. It matches the task objective to
responsibilities before considering workload or dependencies. An explicitly named
owner takes precedence; work spanning responsibilities is split and integrated by
the coordinator, and a missing responsibility is reported rather than filled by
an arbitrary idle member.

## Existing behavior and the gap

The baseline is `9b5fc4d197937f7492329b62630b93f39ef16d29`. `Member.duty` already
survived storage and appeared in `room status`. The missing information was in
ongoing delivery: `store::roster_hint` ran only for user chat addressed to the
coordinator. Member replies, task completion and idle notices omitted that
context. The idle notice explicitly suggested assigning to the idle members it
listed. Duty edits did not notify either the member or the coordinator, and some
membership changes only appeared in the room timeline.

`may_assign` remains an authorization rule. This change adds no semantic routing
algorithm or role keyword table: the model chooses the owner using the supplied
custom responsibilities, and the existing task operations validate the chosen
identity and persist it.

## Shared context and updates

`rooms/scheduling.rs` supplies both coordinator deliveries and the coordinator's
CLI status. It contains assignment rules, all current member IDs and names,
custom duties, Agent types, current session activity, open workload and task IDs.
It also lists the first 20 unfinished tasks and their unresolved dependencies;
the full task board remains available through `room status`.
The bundled Chinese and English Belfry skills use the same responsibility and
identity rules; changing these repository copies does not install them.

All chat and notices delivered to a coordinator use this context. Joining,
leaving, renaming, changing duty and rebinding a session now notify the
coordinator. Duty/name edits also notify the affected member. Resuming a paused
room sends a fresh coordinator notification without replaying messages recorded
while paused. Existing task owners do not change when a duty or session changes.

`enqueue_posts` rebuilds each message from the latest room under the room lock
before accepting it into the collaboration bus. It uses the current session
registry. This is an acceptance-time snapshot, not a mutation of terminal input:
already claimed messages stay immutable, and subsequent changes arrive as
separate notices. The shared rule tells the coordinator to read `room status`
before assigning.

## Identity and wire compatibility

`task add --to` and `task assign` accept a current full member ID as well as the
existing exact, case-insensitive role name. A full ID can have an `@` prefix.
IDs are not prefixes or list positions. An unknown or departed full ID is
rejected; a reused role name does not redirect it to a new member.

The UI keeps the existing `room_task` request shape. A selection should retain
`member.id`, including when the name changes while the form is open:

```json
{"id":"<roomId>","op":{"op":"add","title":"Inspect a sample","outcome":null,"assignee":"<memberId>","after":[]}}
```

```json
{"id":"<roomId>","op":{"op":"assign","task":"T1","assignee":"<memberId>"}}
```

These deserialize as `RoomTaskOp` and go through `commands::apply_task_op` with
`Actor::User`; CLI requests use the same operations with their authenticated
member identity. The `member.duty` UI API is unchanged. T53 owns the UI selection
and display changes.

`RoomStatusView.coordination` is an optional string, omitted for peers. Existing
members/tasks fields and the protocol version remain unchanged. The new CLI
prints the shared coordinator context once; responses from older servers fall
back to the existing member roster. The shared catalog, exported error directory
and both frontend catalogs are synchronized.

## Verification

Deterministic Rust regressions use isolated `RoomStore`, session registry and
collaboration bus instances. They exercise real room actions, durable outboxes,
bus acceptance, final `injection_text`, claim/submission receipts and restart
readback. They do not operate a user's terminal. Coverage includes completion,
idle and member replies, custom duties for two Codex members, updates, session
rebinding, changed activity, dependencies, pause/resume, English output, exact
identity assignment and unchanged state after rejected UI add/assign requests.

The original eight delivery regressions failed on the baseline and passed after
the change. The final 11 cases, including UI request shapes, also failed against
the baseline with the same test source files. The final local checks passed:

| Check | Result |
| --- | --- |
| Room storage, operations and delivery | 69 passed |
| Collaboration bus and real CLI transport | 78 passed |
| CLI, protocol and shared catalog crates | 66 passed |
| Bundled skill installation and language switching in temporary directories | 9 passed |
| Backend catalog validation | 3 passed |
| TypeScript and i18n checks | Passed; 3,413 entries per language |

The room run has three deliberate exclusions: the two existing startup
benchmarks and the separately invoked live-model characterization. The 11
deterministic new cases are included in the 69 passes. Source hashes and raw log
paths are recorded in `/tmp/belfry-t52-handoff.json`. Early fixture setup errors,
the shared-target cache mismatch and the interrupted out-of-space compile are
listed separately from product failures.

The manual model characterization uses `codex exec --ephemeral` with the user's
configured model/provider, a freshly built CLI, a private collaboration endpoint
and temporary identity. It disables hooks, connectors and additional agents for
the sample. It does not use a mock model transport. The model receives actual
room injection text and operates the private room through the real CLI. Each
case records the prompt, model events and command outputs, CLI status before and
after, room snapshots, expected/actual owner IDs, and process exit information.
The samples used the existing installed Belfry skill, as read in the model's
recorded commands. The revised bundled skills were not installed for the test.

The six scenarios are a busy matching member, changed responsibilities, an
explicit owner, work spanning responsibilities, no matching responsibility, and
a departed member whose name was reused. All six passed locally with Codex
0.167.0 and the configured `gpt-6-astra` model; no model override was supplied.
The cross-responsibility result created two member tasks plus a coordinator
acceptance task waiting for both. The no-match and departed-identity results
reported the gap in the room and created no task. These are finite behavior samples of
the configured model, not a guarantee that every future model decision will be
correct. They also do not simulate continuous PTY delivery while the model is
running. The deterministic delivery tests and the model's actual task operations
are separate evidence.

The live case is explicitly ignored in ordinary Cargo runs so CI does not
silently make external model requests. Invoke it deliberately on a Unix host
with Python 3 and a configured Codex executable:

```sh
cargo build --manifest-path src-tauri/Cargo.toml -p belfry-cli
mkdir -p /tmp/belfry-duty-probe-runtime
BELFRY_DUTY_CODEX="$(command -v codex)" \
BELFRY_DUTY_LIVE_ARTIFACTS=/tmp/belfry-duty-probe \
XDG_RUNTIME_DIR=/tmp/belfry-duty-probe-runtime \
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  rooms::duty_test::live::model_assigns_by_current_responsibility_through_the_real_cli \
  -- --ignored --exact --nocapture
```

`BELFRY_DUTY_CLI` can select a freshly built CLI in a custom Cargo target
directory. `BELFRY_DUTY_LIVE_CASE` selects one of the scenario names above (the
exact identifiers are listed in `duty_live_test.rs`). Existing user application
data, release files and installed executables are not changed by the probe.
