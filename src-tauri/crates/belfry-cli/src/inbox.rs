use super::Flags;
use belfry_protocol::{
    Command,
    inbox::{AgentCommand, BatchRequest, EntryVersion, Handling, ResolveRequest, TaskRef},
};

pub(super) fn parse(args: &[String]) -> Result<Command, String> {
    let flags = Flags::parse(
        args.get(1..).unwrap_or_default(),
        &[
            "--room",
            "--cursor",
            "--limit",
            "--entry",
            "--state",
            "--op",
            "--question",
            "--task",
            "--task-kind",
            "--task-room",
            "--generation",
            "--topic",
            "--revision",
            "--priority",
            "--hold-until",
            "--attempt",
            "--sequence",
            "--decision",
        ],
        &["--clear", "--resume"],
    )?;
    let limit = flags
        .one("--limit")
        .map(|value| value.parse::<usize>().map_err(|_| "--limit must be a positive integer".to_string()))
        .transpose()?;
    let operation = || {
        flags.one("--op").ok_or_else(|| {
            "Supply --op <stable-operation-id>; reuse it only when retrying the same operation".to_string()
        })
    };
    let number = |name: &str| -> Result<u64, String> {
        flags
            .one(name)
            .ok_or_else(|| format!("{name} is required"))?
            .parse()
            .map_err(|_| format!("{name} must be an unsigned integer"))
    };
    let entries = || -> Result<Vec<EntryVersion>, String> {
        let values = flags.all("--entry").into_iter().chain(flags.positional.clone());
        let entries: Vec<_> = values
            .map(|value| {
                let (id, revision) = value
                    .rsplit_once('@')
                    .ok_or("Entry must be <entry-id>@<revision>, as returned by inbox list/read")?;
                Ok(EntryVersion { id: id.into(), revision: revision.parse().map_err(|_| "Invalid entry revision")? })
            })
            .collect::<Result<_, String>>()?;
        if entries.is_empty() { Err("At least one entry revision is required".into()) } else { Ok(entries) }
    };
    let command = match args.first().map(String::as_str) {
        Some("batch") => AgentCommand::BatchGet { batch_id: flags.positional.first().cloned().ok_or("inbox batch requires the original batch ID")? },
        Some("resolve") => AgentCommand::Resolve { request: ResolveRequest { batch: BatchRequest {
            batch_id: flags.positional.first().cloned().ok_or("inbox resolve requires the original batch ID")?,
            attempt_id: flags.one("--attempt").ok_or("--attempt is required")?, expected_revision: number("--revision")? },
            sequence: number("--sequence")?, decision: match flags.one("--decision").as_deref() { Some("submitted") => "submitted".into(), Some("abandon") => "abandon".into(), _ => return Err("--decision must be submitted or abandon, after checking the original target".into()) } }, operation_id: operation()? },
        Some("list") => AgentCommand::List { room: flags.one("--room"), cursor: flags.one("--cursor"), limit },
        Some("read") => AgentCommand::Read { message_id: flags.positional.first().cloned().ok_or("inbox read requires a message ID")?, cursor: flags.one("--cursor"), limit },
        Some("ack") => AgentCommand::Ack { entries: entries()?, state: match flags.one("--state").as_deref() { Some("processing") => Handling::Processing, Some("processed") => Handling::Processed, _ => return Err("--state must be processing or processed".into()) }, operation_id: operation()? },
        Some("withdraw") => AgentCommand::Withdraw { entries: entries()?, operation_id: operation()? },
        Some("wait") => AgentCommand::Wait { question_ids: flags.all("--question"), task: flags.one("--task").map(|id| {
            Ok::<TaskRef, String>(TaskRef { kind: flags.one("--task-kind").unwrap_or_else(|| "room_task".into()), room_id: flags.one("--task-room"), id, generation: number("--generation")? })
        }).transpose()?, clear: flags.has("--clear"), operation_id: operation()? },
        Some("policy") => AgentCommand::Policy { room: flags.one("--room"), topic_id: flags.one("--topic").ok_or("--topic is required")?, expected_revision: number("--revision")?,
            priority: flags.one("--priority"), hold_until: flags.one("--hold-until").map(|value| if value == "manual" { Ok(i64::MAX) } else { value.parse::<i64>().map_err(|_| "--hold-until must be epoch milliseconds or manual".to_string()) }).transpose()?, resume: flags.has("--resume"), operation_id: operation()? },
        _ => return Err("Use inbox list/read/ack/wait/policy/withdraw/batch/resolve. Plain `belfry inbox` retains the direct-task list.".into()),
    };
    Ok(Command::CollaborationInbox { command })
}

pub(super) const HELP: &str = "\n\nCollaboration inbox (requires collaboration-inbox-v1):
  belfry inbox batch <batch-id>
  belfry inbox resolve <batch-id> --attempt <attempt-id> --revision <n> --sequence <n>
      --decision submitted|abandon --op <id>  (recipient or room coordinator; verify the target first)
  belfry inbox list [--room <name>] [--cursor <cursor>] [--limit <n>]
  belfry inbox read <message-id> [--cursor <cursor>]
  belfry inbox ack <entry-id>@<revision>... --state processing|processed --op <id>
  belfry inbox withdraw <entry-id>@<revision>... --op <id>
  belfry inbox wait --question <question-id>... [--clear] --op <id>
      Optional assignment: --task <id> --task-kind room_task|direct_task --task-room <room-id> --generation <n>
      Declares waiting and returns immediately; finish the Agent turn so replies can arrive.
  belfry inbox policy --room <name> --topic <full-topic-id> --revision <n>
      [--priority normal|high] [--hold-until <epoch-ms>|manual] [--resume] --op <id>
  belfry room say <text> [--topic <id>] [--question <text>]... [--answer <question-id>]...
      [--class discussion|reply|fyi] [--correction-of <message-id>] [--op <id>]
      --reply only answers legacy questions; explicit questions need --answer.
  belfry room task done <id> --generation <n> [--room <name>] <result>
Reusing --op with different content is rejected. None of these reads claims or sends messages.";
