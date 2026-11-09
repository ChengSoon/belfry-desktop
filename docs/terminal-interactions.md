# Terminal interaction contract

Room consumers can read `TerminalCommandTarget.readInteraction()` on every live member target, independently of the coarser `memberStatus`/activity value. Types are exported by `src/terminal/interaction.ts`. Existing `readChoice`/`answerChoice` consumers remain compatible.

`TerminalInteraction` provides an opaque `requestId`, `source.sessionId` (the PTY), Agent kind, question, context, option labels/descriptions, current cursor, checked indices, optional input metadata and submission state. The source text is not translated. Manually wrapped labels/descriptions retain line breaks. The live xterm screen is read independently of scrollback position, without the former 30-line cut-off; xterm soft wraps retain their spaces.

Poll the complete value, not just the ID: `selected`, `selectedIndices` and `state` change within one request. Bind local drafts and receipts to both target/source and request ID. Check that the member still owns that target when submitting. Native conversation changes, terminal buffer changes, disconnects and observed disappearance invalidate old IDs. Opening Other/notes can create a new input request. The controller observes output even when the room is hidden.

## Answers and results

Call `answerInteraction(requestId, answer)` only for a user action:

| Request | Answer |
| --- | --- |
| `single`, `confirmation` | `{ kind: "single", index }` |
| `multiple` | `{ kind: "multiple", indices }` (desired checked set) |
| `input` | `{ kind: "input", text }` |
| `unknown` | Terminal entry only; no synthesized answer |

The cursor is not user consent. An empty answer is accepted only when the original input explicitly says optional (`input.optional=true`), and still requires a user submission. Existing input drafts are exposed as unknown instead of being overwritten. Control characters and oversized input are rejected. Multi-line input requires bracketed paste.

The Promise returns `sent`, `changed`, `unavailable`, `busy`, `invalid`, `failed` or `uncertain`. `sent` means the final PTY write completed; it does not mean a command ran or an Agent task completed. The controller retains a consumed request so repeated clicks cannot write it again. `busy` also covers output not yet parsed and an already consumed request. `failed` is a pre-write failure; any attempted write with an unconfirmed outcome becomes `uncertain`. Do not automatically retry uncertainty. Keep the terminal entry available.

Answers share the keyboard input queue. The source, request, screen, cursor/check state and output readiness are checked again after earlier input has drained. Navigation/toggles are written first; the observed cursor and checked set must reach the requested state before Enter is sent. Unrecognized/remapped navigation is allowed 1.5 seconds to produce evidence, then returns uncertainty without Enter. Text uses xterm's native paste encoding, waits for the existing platform paste interval, rechecks context and manual input, and writes Enter once. A changed request, disconnected session or intervening user input suppresses that Enter.

## Verified format coverage

| Format | Coverage and evidence |
| --- | --- |
| Codex new-conversation/worktree numbered menu | Existing behavior retained; labels and aligned descriptions separated. User screenshot supplies the representative menu. |
| Codex command/permission confirmations | Current 0.167.0 permissions picker captured from an isolated local PTY; execution/permission render fixtures from the same upstream release. Full visible context is retained. Explicitly clipped context (`[… N lines]`) stays terminal-only. |
| Codex asynchronous suggested answers | Wrapped labels, normal Enter submission, Other transition and unknown/remapped fallback. Version-pinned rendered snapshots and real xterm parsing. |
| Codex `request_user_input` | Numbered options/descriptions, question/page identity, freeform and notes input, optional empty answer. Version-pinned snapshots; native browser paste and controlled input-consumer execution. |
| Codex model/mode menus | Current model and permission-mode pickers captured. A contiguous numbered visible page can be answered; `optionsComplete=false` must display a terminal entry for remaining options. This is partial pagination support, not extraction of hidden options. |
| Codex checkbox picker | A complete unfiltered menu with explicit Space/Enter hints can submit a desired set. A visible overflow arrow, active filter, disabled/truncated item or unknown mapping stays terminal-only. Current status-line picker is captured as a partial/unknown example. |
| Explicit `y/n` confirmation | Recognized at the live cursor line; displayed capitalization is preserved and no default is selected automatically. A printed line followed by an empty cursor line is not actionable. |
| Claude / Kimi numbered permissions | Existing fixtures retained; Kimi description rows and Claude's command above its question are preserved. No new live third-party login/permission operation was performed. |
| OpenCode 2.2 horizontal permissions | Existing color contract retained; focused inverse cell colors are verified in real xterm and use horizontal navigation. |
| Other layouts / unknown requests | Positive widget/hook evidence preserves a visible unknown request. Plain questions, numbered prose, checklists and quoted/fenced menu examples are not treated as pending input. |

This is a screen adapter, not a structured Agent approval protocol. Non-Codex checkbox layouts, hidden/filtered checked items, arbitrary remapped submit keys, clipped contexts and unrecognized forms require the terminal. The application does not operate a live user approval during testing.

## Evidence and validation

- `src/terminal/fixtures/codex-current-menus.json`: sanitized rendered menus from local Codex CLI 0.167.0, captured on 2026-11-09 by opening `/model`, `/permissions`, `/statusline` in a separate PTY. No item was selected. Raw ANSI and rendered files are retained under `/tmp/belfry-t35-cli-capture` on the task host.
- `src/terminal/fixtures/codex-0.167.0.json`: 14 upstream render snapshots, pinned to `086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a`. Paths and license attribution are retained. These are distinct from live PTY samples and from executed answers.
- `choice.regression.test.ts`: the same six assertions fail against the old `b371a001` implementation and pass with this change. They cover the current permissions picker, async wrapping, model descriptions, freeform activity, checkboxes and long command context in a real xterm buffer.
- `choiceParser.test.ts`, `interaction.test.ts`, existing terminal/hook tests: content, state transitions, provenance, navigation evidence, duplicate/stale/detached writes, partial failure and input cancellation.
- `terminal-choice.case.mjs`: opens a real browser/xterm with its textarea/paste path. A separate deterministic Node input consumer receives raw bytes, checks the actual chosen confirmation/checked set/text, advances requests and rejects replay of the previous request. It never executes the displayed fixture command and is not a live Agent approval test.

Run the terminal/hook Vitest suites, `node --test src/components/lazy/testing/terminal-choice.case.mjs`, type/build and i18n checks. The normal CI browser discovery includes the six new browser/consumer cases on both macOS and Windows. CI results and exact final commit are recorded in the T35 task handoff; older T32/PR17 evidence is not re-run or replaced.
