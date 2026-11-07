# CCCC source attribution

Belfry's collaboration rooms (`src-tauri/src/rooms/`) adapt designs from
[ChesterRa/cccc](https://github.com/ChesterRa/cccc), commit `2fa61a5951c2d8325bc0338ff1dafea8c0df2dae`,
licensed under the Apache License 2.0. The original license is preserved in [LICENSE](./LICENSE).

Adapted from CCCC:

- `docs/standards/CCCS_V1.md`: the message ledger's event envelope and kinds (`chat.message`,
  `system.notify`, `runtime.delivery`, `chat.reply_request.cancelled`), the append rules for a torn
  last line, recipient routing (`@all`, `@peers`, `@foreman`, `@user`, single audience per message,
  `default_send_to`), and `request_reply` obligations that a `reply_to` message fulfills.
- `docs/standards/CCCC_CONTEXT_OPS_V1.md` and `docs/reference/architecture.md`: the foreman / peer roles
  and permission rules, the coordination brief (objective, current focus, constraints), and the task
  board (`T<number>` ids that are never reused, `planned / active / done / archived` statuses,
  assignee, `blocked_by`, revision counter).

Belfry modifications: timestamps are milliseconds, the group id is named `room_id`, `runtime.delivery`
records only `accepted`, tasks and the brief are stored in `rooms/rooms.json` rather than a separate
context store, delivery reuses Belfry's existing terminal prompt queue, and the foreman is notified of
task completion and idle members through ledger notices instead of a daemon automation loop. The Rust
and TypeScript code is written for Belfry; no CCCC source files are copied verbatim.
This notice does not relicense unrelated Belfry code.
