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
| `queued` | Explicit `openInteraction(requestId)`; no answer until the editor opens |
| `unknown` | Terminal entry only; no synthesized answer |

The cursor is not user consent. An empty answer is accepted only when the original input explicitly says optional (`input.optional=true`), and still requires a user submission. Existing input drafts are exposed as unknown instead of being overwritten. Control characters and oversized input are rejected. Multi-line input requires bracketed paste.

The Promise returns `sent`, `changed`, `unavailable`, `busy`, `invalid`, `failed` or `uncertain`. `sent` means the final PTY write completed; it does not mean a command ran or an Agent task completed. The controller retains a consumed request so repeated clicks cannot write it again. `busy` also covers output not yet parsed and an already consumed request. `failed` is a pre-write failure; any attempted write with an unconfirmed outcome becomes `uncertain`. Do not automatically retry uncertainty. Keep the terminal entry available.

Answers share the keyboard input queue. The source, request, screen, cursor/check state and output readiness are checked again after earlier input has drained. Navigation/toggles are written first; the observed cursor and checked set must reach the requested state before Enter is sent. Unrecognized/remapped navigation is allowed 1.5 seconds to produce evidence, then returns uncertainty without Enter. Text uses xterm's native paste encoding, waits for the existing platform paste interval, rechecks context and manual input, and writes Enter once. A changed request, disconnected session or intervening user input suppresses that Enter.

## Queued Codex questions

Codex 0.167.0 can keep working while its question editor is closed. The visible entry is `• Queued follow-up inputs`, `? N question(s)` and `shift+← to answer` (or `⇧← to answer`). Historical question text and unnumbered bullet options above it are not an answer surface. The adapter returns `kind="queued"`, `queue.count`, empty question/options/input, and `state="pending"`. Consumers supply a generic open-question label and keep the member's existing Working status. Ordinary prose, quoted/fenced examples and other Agents do not acquire this key binding. A changed/missing binding or an occupied/unrecognized main composer produces `unknown` with a terminal entry.

`openInteraction(requestId, optionIndex?)` returns `TerminalInteractionOpenResult`: either `{ status: "opened", requestId }`, or one of `changed`, `unavailable`, `busy`, `invalid`, `failed`, `uncertain`. The queued call omits `optionIndex`. It writes only Shift+Left (`ESC [ 1 ; 2 D`) through the existing input queue, changes the old state to `opening`, and requires observed async editor evidence from the same PTY/native conversation before returning `opened`. It never writes Enter or reports an answer as submitted. Ignored input, a changed source or intervening user input cannot become success and is not retried automatically.

The returned ID belongs to the newly visible editor. Re-read it and revalidate ownership before rendering or sending a later answer; ignore receipts belonging to a previous member/target/request. The entry ID includes the terminal attachment, native conversation, buffer type, visible context and live queue-heading position. Observed disappearance/reappearance or a same-count content replacement invalidates it; spinner/countdown changes do not. It is a screen-entry generation, not Codex's native `questionItemId`. A completely hidden, visually identical native replacement cannot be distinguished from pixels, which is why the collapsed entry can only open the editor.

An expanded async editor's complete final `Other` option carries `action="input"`. Use `openInteraction(requestId, option.index)` for that option as well: arrows only, verify the same question's actual input surface, then return `opened` and its new ID. Calling `answerInteraction` for this option is invalid. Ordinary options keep their existing single-answer action. A client without `openInteraction` must use its terminal entry for Other. Existing terminal drafts remain `unknown`; only a subsequent explicit input submission may send text and Enter. Narrow wrapped footer hints and `prev question` editors are recognized; hidden/incomplete menus retain the existing terminal fallback.

## Verified format coverage

| Format | Coverage and evidence |
| --- | --- |
| Codex new-conversation/worktree numbered menu | Existing behavior retained; labels and aligned descriptions separated. User screenshot supplies the representative menu. |
| Codex command/permission confirmations | Current 0.167.0 permissions picker captured from an isolated local PTY; execution/permission render fixtures from the same upstream release. Full visible context is retained. Explicitly clipped context (`[… N lines]`) stays terminal-only. |
| Codex asynchronous suggested answers | Working queue discovery, explicit open, wrapped labels/footer hints, single answers, Other and marker-free text. Real isolated Codex PTY samples and actual generic answers consumed by its engine; independent xterm/stdin consumer. |
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

### T50 queue evidence (2026-11-10)

Base: `9b5fc4d197937f7492329b62630b93f39ef16d29`. `fixtures/codex-queued-0.167.0.json` contains nine real PTY screen projections with full ANSI SHA256 references: one/two-question collapsed entries, first/later editors, Other and existing drafts. The Codex binary is 0.167.0; version-pinned render source is `086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a`. Existing Belfry hooks expose lifecycle state, not async question payloads/IDs; the production adapter continues to read the live terminal rather than treating a transcript as a control protocol.

On the task host, `/tmp/belfry-t50-live-final`, `-live-text` and `-live-pair` retain raw ANSI, key logs, rendered checkpoints and exact `<send_user_message_question_reply>` receipts. These use the real Codex UI/engine in separate PTYs/workspaces, with deterministic localhost Responses streams and generic questions, without a remote model or a user session. Other/text and the second of two questions were consumed with IDs `["request_user_input_async","t50_call_1",0]` / `[...,1]`. Opening, moving to Other and pasting had zero answer receipts until Enter. Earlier exploratory single-answer evidence in `/tmp/belfry-t50-live` also consumed the correct Green answer, but its logging callback error and 300-second stream reconnects are retained as explicit probe limitations, separate from the corrected captures.

The 15 queue parser checks fail 11/pass 4 on the exact old product sources; the old real-xterm queue consumer case fails at the missing entry assertion. Final terminal suites pass 314/314 across 32 files. All seven browser cases pass without skips; the new case consumes Green, multiline text and Other for three distinct question IDs, using ten writes to the isolated PTY. `/tmp/belfry-t50-browser-final-artifacts/terminal-queued-consumption.json` records the separate opens/answers and writes, alongside screenshots. The 20 new controller cases cover stale IDs, same-count replacement, repeated opening, manual input, attachment/native scope changes, ignored keys, partial errors and explicit Other navigation. These are local validations; T51 supplies the RoomView click integration and the coordinator controls combined CI/release work.
