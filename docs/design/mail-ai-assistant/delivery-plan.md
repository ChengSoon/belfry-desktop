# Mail AI Assistant - Delivery Plan

Status: backend v0.2 delivered and reviewed; UI design and final alignment pending.
Parent task: `jywsjkyn`. Backend handoff notification: `tjk0gyqd`.
Shared scope: [brief.md](brief.md).

## Available team

- Project manager: requirements, implementation breakdown, integration review,
  and acceptance plan.
- Backend engineer: service architecture, data model, and API contract.
- UI: interaction design and a clickable prototype.
- The previously named development-engineer session is not currently in the
  peer roster. Implementation planning remains with the project manager.

## Design work packages

| Package | Owner | Output | Dependency | State |
| --- | --- | --- | --- | --- |
| D0 Shared scope | Project manager | brief.md | User discussion | Written |
| D1 Backend and API | Backend engineer | backend-design.md, api-contract.md | D0 | v0.2 delivered via tjk0gyqd; document checks and credential alignment passed |
| D2 Interaction and prototype | UI | ui-design.md, prototype.html | D0; align with D1 before handoff | Design and prototype files present; final handoff pending: 5m50qhnt |
| D3 Implementation and acceptance | Project manager | delivery-plan.md | D0 | Written |
| D4 Cross-design review | Project manager | review.md | D1 and D2 | Backend v0.2 reviewed; UI/API alignment and prototype review pending |

Task identifiers and actual completion states are recorded as they are verified.
Queued delivery is not evidence that an owner has started or completed work.

The initial assignments were `ejcek8yv` (backend) and `tm1mvzq6` (UI).
During coordination, old task records became unavailable, and the parent task
also disappeared from the local inbox. No cause has been established. Follow-up
assignments `xcm3845h` and `5m50qhnt` reference the existing work to recover
handoff tracking without restarting design. File presence alone does not prove
that a design is complete or reviewed.

The coordinator attempted `belfry done jywsjkyn` after completing the kickoff;
the CLI rejected it because that task ID no longer exists. The kickoff outcome
is preserved in these files, but completion could not be registered in Belfry.

Backend subsequently reported the same missing-record failure for `ejcek8yv`
and `xcm3845h`, and delivered v0.2 through independent notification `tjk0gyqd`.
The coordinator verified the artifacts and closed the credential-binding
document mismatch. This records actual handoff without claiming the missing
original task records were successfully marked done.

## Proposed implementation milestones

### M1: One complete workflow

- Create the service boundary, persistence, account configuration, and secret
  references; keep deployment independent from the current Belfry application.
- Connect a test IMAP account, normalize message content, and save incremental
  state with durable messages.
- Execute one selected AI task through a provider interface, validate the
  output, and persist a result linked to the original mail and task version.
- Provide account settings, a result view, and separate sync/AI histories.
- Include scheduling, manual execution, deduplication, and bounded retries.

Exit: authorized test mail can travel through the real workflow, and recovery
cases below pass. A mocked prototype does not satisfy this milestone.

### M2: Broader verified support

- Enable multiple accounts, bindings, filters, task templates, and custom
  instructions without duplicating the core pipeline.
- Add and verify Gmail and Microsoft authorization, token renewal, revocation,
  and incremental synchronization.
- Publish a tested provider/feature matrix. Keep not-yet-tested and unsupported
  configurations visibly distinct from verified configurations.

Exit: representative accounts and task templates pass isolated and combined
workflows, and one failed connection or task does not stop unrelated work.

### M3: Extended processing and destinations

- Add time-bounded historical import and explicit reprocessing controls.
- Add scheduled reports, timezone handling, and aggregate result provenance.
- Add attachment text extraction/OCR and optional output integrations.
- Specify any automatic external action as a separate feature with its own
  permissions, delivery behavior, and acceptance criteria.

Exit: each extension has its own failure and recovery checks. M3 features are
not necessary to prove M1.

## Acceptance scenarios

| Scenario | Required outcome |
| --- | --- |
| Read a new mail in another client before polling | It is still imported and processed |
| Run the same sync twice | No duplicate messages or ordinary visible results |
| Restart after fetch, before checkpoint commit | Mail is recovered without being silently skipped |
| Restart after an AI response, before saving | Retry behavior and duplicate-call/cost limitations are explicit; visible results are deduplicated |
| Reset IMAP UIDVALIDITY or invalidate an API cursor | Controlled resync with a defined scope and deduplication strategy |
| Fail one of several AI tasks on one message | Successful results remain; only the failed task needs retry |
| Expire mailbox authorization | Connection state and recovery action are visible |
| Hit network failure or provider rate limits | Bounded backoff, observable state, and no silent loss |
| Leave the browser closed | A running background service continues its schedule |
| Suspend and restart the service host | Defined catch-up behavior without overlapping or unbounded runs |
| Receive mail with no deadline or owner | AI output preserves unknown fields |
| Complete a sync with zero new mail | The UI shows success and a zero count |
| Edit a task and intentionally rerun mail | Result versioning differs from a retry |
| Use the core UI on a narrow viewport and keyboard | Configuration, results, and recovery remain usable |

## Design exit criteria

- Backend design and API examples cover the complete M1 workflow and leave
  coherent extension points for M2/M3.
- Prototype demonstrates the principal journey and at least one recoverable
  failure using clearly labelled sample data.
- UI field names, identifiers, states, and actions agree with the API contract,
  or every remaining mismatch is recorded with an owner.
- Validation performed, remaining assumptions, and real-integration prerequisites
  are recorded without claiming that planned features already work.

## Decisions to resolve before live integration

- Runtime host and service lifecycle.
- Actual test mailbox and its authentication requirements.
- AI endpoint/model and secret provisioning.
- Retention and deletion policy for original mail and generated results.
- Whether an external result destination is required for M1.
