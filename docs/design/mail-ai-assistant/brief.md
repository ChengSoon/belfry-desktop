# Mail AI Assistant - Shared Design Brief

Status: design in progress. No production implementation or live integrations.
Coordinator: project manager. Parent Belfry task: `jywsjkyn`.

## Objective

Periodically retrieve email from multiple accounts, run configurable AI tasks,
and let the user inspect, retry, and export the results. The user's requested
direction is broad mailbox and AI-task support, delivered in verified stages.

## Working assumptions

- Standalone background service with a responsive web interface; this is not
  yet a feature to embed in Belfry. These documents live here for coordination.
- Single-user deployment initially, with multiple mailbox connections.
- The service must stay running for schedules to execute. Closing a browser
  does not stop it; suspending the host does. Define recovery after downtime.
- Default polling interval: five minutes. Initially process new Inbox messages
  after activation, regardless of read/unread state. Historical import is an
  explicit, separately scoped operation.
- Store results in the application by default. External notifications and
  integrations are later outputs, not prerequisites for the first workflow.
- Design configuration for an AI service and model, including connection
  testing. Real providers and credentials remain deployment decisions.
- Process subject, sender, and message body initially. Attachment metadata is
  visible; attachment contents and OCR require a later capability.
- Reply drafts are editable results. Sending email is a separate future action.

## Scope and stages

1. Design the complete multi-account and multi-task experience now. The first
   implementation increment proves one IMAP account and one AI task end to end,
   within that extensible design.
2. Complete account management and task selection, plus Gmail and Outlook
   official authorization and adapters. Verify each supported provider rather
   than labelling every mailbox as already compatible.
3. Add historical import, attachment processing, scheduled aggregate reports,
   and optional external outputs. Represent these honestly in the prototype.

Mailbox adapters: generic IMAP, Gmail API, and Microsoft Graph. Actual access
depends on provider features, account authorization, and administrator policy.
Do not promise compatibility with providers that expose no supported interface.

AI task templates: summary, classification, todo extraction, structured field
extraction, translation, and reply draft. Custom instructions extend these.
Reports aggregate a selected time range and have their own schedule; they are
not just another per-message prompt.

## Shared concepts

- MailboxConnection: provider, account identity, connection state, capabilities,
  credentials reference, and per-folder synchronization state.
- SyncPolicy: mailbox, folders, polling interval, activation boundary, and
  enabled state. Connection health and schedule state are separate concepts.
- MailMessage: stable internal ID, provider identity, source folder/labels,
  received timestamp, normalized content, and attachment metadata.
- AITaskDefinition: template, matching conditions, instructions, model settings,
  output schema, version, and enabled state. A connection can feed many tasks.
- TaskBinding: the explicit association between a mailbox and an AI task.
- SyncRun and AITaskRun: independent histories, outcomes, retries, and errors.
- Result: structured output linked to a message, task version, and execution.
- ReportDefinition: aggregation range, timezone, schedule, and source tasks.

The backend owns exact names, fields, enums, and API examples in
`api-contract.md`. The UI must align with that contract before final handoff.

## Required behavior

- Persist newly fetched messages before advancing the sync checkpoint.
- Never use unread status as a substitute for an incremental cursor.
- Define mailbox/folder identity and IMAP UIDVALIDITY recovery. Message-ID is
  not sufficient as the sole deduplication key.
- Repeated syncs and worker restarts must not create duplicate visible results.
  Distinguish retry from an intentional rerun under a changed task version.
- One AI task failing must not discard the message or other successful tasks.
- Define timeouts, retry backoff, rate limits, overlap prevention, and limits
  on work queued when a provider or AI service is unavailable.
- Treat model output as fallible: validate structured fields and preserve
  unknown values rather than inventing owners, deadlines, or amounts.
- Store credential references separately from ordinary configuration; redact
  secrets and mail content in routine logs. The prototype uses sample data.
- Treat email content as untrusted input, never as authorization for sending
  mail, executing commands, or following external instructions.
- Show last success, next planned check, progress, and actionable failures.
  An empty successful sync is visibly different from a failed sync.

## UI workflows

Three primary areas: Configuration, Results, and Run History.

1. Connect mailbox -> test connection -> configure sync -> enable.
2. Configure AI service -> choose task template -> bind mailboxes -> save.
3. Run now -> inspect progress -> open result beside its source email.
4. Recover from an expired authorization, failed sync, or failed AI task.
5. Filter across accounts and task types; edit or copy a reply draft.

Use explicit mock labels for simulated connections and executions. Include
empty, loading, success, partial failure, and failure states. Check desktop
and mobile layouts and keyboard access to the core workflow.

## Ownership and deliverables

| Owner | Exclusive files | Deliverable |
| --- | --- | --- |
| Project manager | brief.md, delivery-plan.md, review.md | Scope, milestones, coordination, acceptance and review |
| Backend engineer | backend-design.md, api-contract.md | Components, data model, sync/AI reliability, API and error contract |
| UI | ui-design.md, prototype.html, assets/ | Interaction specification and a clickable responsive prototype |

All paths are under `docs/design/mail-ai-assistant/`. Do not edit another
owner's files. Existing work elsewhere in the repository is outside this task.
Do not start production code, deploy services, or connect real email accounts.

## Coordination and handoff

- Backend should publish the API contract early so UI can align its mock data.
- UI can start with the shared concepts immediately; it must identify any
  contract gaps in its handoff. The coordinator resolves cross-file conflicts.
- Each owner reports created paths, validation performed, unresolved choices,
  and the next implementation step via `belfry done` for its assigned task.
- Project manager reviews the two designs together, records remaining risks,
  and separates verified artifacts from future implementation claims.

## Open deployment decisions

Host environment, actual AI provider/model, test mailbox authorization,
retention period, and external notification destinations are unresolved.
These do not block design. They must be settled before their real integration
or deployment; credentials must be configured through an appropriate secret
input mechanism rather than included in the design files.
