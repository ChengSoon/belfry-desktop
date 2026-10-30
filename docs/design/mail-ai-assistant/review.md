# Mail AI Assistant - Design Review

Status: backend v0.2 handoff reviewed; UI handoff and cross-design review pending.

## Evidence received

- Shared scope and delivery plan are written.
- Backend delivered `api-contract.md` and `backend-design.md` v0.2 through
  notification `tjk0gyqd`; both documents have been reviewed.
- The coordinator independently checked 27 JSON examples (including duplicate
  key detection), six relative links, three run example states/error objects,
  two timestamp-order pairs, fence pairing, and trailing whitespace. All passed.
- UI has created `ui-design.md`, `prototype.html`, and local assets. Its design
  note still says work is in progress; final interaction/visual review is pending.
- Live mailbox access, AI integration, and production behavior are untested.

## Cross-design checks

| Check | Current state | Owner |
| --- | --- | --- |
| Separate connection health from schedule enabled state | API defines the distinction; UI alignment pending | Backend and UI |
| Separate sync history from AI execution history | API defines independent statuses; UI alignment pending | Backend and UI |
| Capability gating and explicit simulated data | API defines planned/implemented/verified; UI check pending | UI |
| Configure AI service, template, mailbox binding, then execute | End-to-end prototype review pending | UI |
| Failed AI task preserves successful results and supports retry | Defined consistently in backend/API v0.2; prototype review pending | Backend and UI |
| Empty sync is a visible success, not an error | Defined consistently in backend/API v0.2; prototype review pending | Backend and UI |
| Draft editing/copying without an implied send action | API v0.2 specifies editing and local copying; prototype review pending | Backend and UI |
| Task version, deliberate rerun, and retry are distinct | Backend/API v0.2 design reviewed; implementation verification pending | Backend |
| Credential rotation and service endpoint versioning | Resolved in API 5.1 and backend 8; UI alignment and implementation verification pending | Backend and UI |
| Desktop, narrow viewport, and keyboard interaction | Owner validation and artifact inspection pending | UI |

## Resolved alignment item

The v0.1 draft mismatch is resolved in API section 5.1 and backend section 8
of v0.2. Each configuration version binds credentials to its own full target
identity. Changing the target creates a new, initially unconfigured binding;
old tasks retain their old endpoint and binding. Credential updates use an
explicit configuration-version path. Same-target reuse is explicit and checked;
cross-target reuse and automatic HTTP redirects are disallowed.

The coordinator verified that the previous service-wide latest-key rule is
absent from the API document. This closes the document inconsistency only;
endpoint/credential isolation still needs implementation tests. UI must align
its credential form, connection tests, and version state with the updated API.

A direct contract-update notification to UI was attempted during this handoff,
but Belfry rejected delivery because the target could not receive instructions.
Do not assume UI has acknowledged this change; it remains an explicit check
for the final UI handoff, with this shared document as the recorded baseline.

## Kickoff outcome

The requested summary, assignment, shared design baseline, delivery ownership,
implementation milestones, and acceptance plan are in place. Both assigned
owners have created design artifacts, which demonstrates work has started.
Backend v0.2 has now been handed off and reviewed. UI's final handoff remains
pending; no overall design approval or functional prototype validation is
implied by completing the coordination kickoff.

## Next coordination step

Receive the final UI handoff, inspect the clickable prototype against API v0.2,
and record remaining mismatches and integration prerequisites before calling
the complete designs implementation-ready. Backend document checks do not
constitute live mailbox, model, or production verification.
