# Room member identity and duties

Room members are identified by `RoomMember.id`. Their `title` and `duty` are
user-controlled fields; `agent` describes the runtime and `tabId` identifies its
session. Neither a row index nor an Agent kind identifies a member.

The new-room roster and Add member dialog send each row's `title`, `duty`, Agent
kind and chosen/launched session together through `roomAddMember`. Changing the
Agent does not reset the name or duty. The backend creates the member ID and
returns the updated room; subsequent `room_get` snapshots preserve that ID.
Removing the first new-room roster row promotes the next row to coordinator but
keeps that row's name and duty. There is no drag-to-reorder roster control.

`roomUpdateMember(id, memberId, patch)` sends edits to that member ID. It is an API
wrapper with no current GUI editor; the audit exercises this API and observes its
returned/polled snapshot without adding an unrelated editing feature. The member
list reads the returned `member.duty`; while a member has an active task, that
line intentionally shows the task instead. Task cards resolve their owner from
`task.assignee` against member IDs, including historical members.

## Fixed boundaries

- Task creation previously kept a role name as the selection. Renaming the
  selected member, then giving another member the old name, silently changed the
  target. Removing the selected member and reusing the name had the same effect.
  Task creation and reassignment now submit member IDs. A known departed
  selection keeps the title, criteria and dependencies but blocks creation until
  the user chooses another member. It never becomes an unassigned task silently.
- New-room duplicate validation normalized the current row but compared it to
  unnormalized draft rows. Names such as ` @Atlas ` and `  atlas  ` slipped past
  the UI although the backend rejected them. Both sides now use the same
  whitespace and leading-`@` normalization before comparison.

The task operation uses the existing `{ id, op: { op, assignee, ... } }` payload.
**This UI change requires T52's backend support for complete member IDs** in
`rooms::ops::assignee_id`; the backend keeps name-based CLI compatibility and
rejects departed or unknown IDs. Integrate T52 before this commit. This change
does not implement responsibility matching or decide which member should work.

## Verification

`src/components/lazy/testing/rooms-members.case.mjs` uses the real RoomView,
controls, hooks and public API wrappers with an isolated native adapter. It
records request/return objects and checks custom duties for multiple Codex
members, Agent changes, add/remove, duplicate names, failures/retry, API edits,
reordered snapshots, restoration, task creation/reassignment and English/Chinese
720×480 windows at 20px. Selection uses real mouse events and waits for the
closing select portal before the next click. No live room, terminal or user data
is modified.

The adapter accepts both the existing role names and T52's member IDs. These
browser results prove UI data association and the outgoing request shape; they
do not prove Rust persistence or model assignment behavior. T52 supplies the
native `RoomTaskOp` / `RoomStore` routing checks and separate model evidence.
Reload tests restore isolated browser storage, not the user's application store.

Local old/new logs, screenshots, source hashes and the detailed scope are in
`/tmp/belfry-t53-validation.json` and `/tmp/belfry-t53-acceptance.md`.
