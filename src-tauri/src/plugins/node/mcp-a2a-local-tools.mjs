import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { apiError } from "./errors.mjs";
import { activeContext } from "./execution.mjs";
import { isObject } from "./manifest-values.mjs";
import { textResult } from "./mcp-results.mjs";
import { a2aErrorResult, a2aPlatformCall, publicA2AConnections } from "./mcp-a2a-tools.mjs";

const id = { type: "string", minLength: 1, maxLength: 128 };
const text = { type: "string", minLength: 1, maxLength: 65536 };
const roomText = { type: "string", minLength: 1, maxLength: 4000 };
const briefText = { type: "string", maxLength: 65536 };
const generation = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const strings = (item, maxItems) => ({ type: "array", items: item, maxItems });
const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const artifact = object({ name: { type: "string", minLength: 1, maxLength: 120 }, text }, ["text"]);
const operations = [
  object({ op: { const: "add" }, title: { type: "string", minLength: 1, maxLength: 80 }, outcome: text, assignee: id, after: strings(id, 64) }, ["op", "title"]),
  object({ op: { const: "assign" }, task: id, assignee: id }, ["op", "task", "assignee"]),
  object({ op: { const: "reopen" }, task: id }, ["op", "task"]),
  object({ op: { const: "archive" }, task: id }, ["op", "task"]),
];

export const A2A_LOCAL_INSTRUCTIONS = "When local collaboration tools are available, use A2ALocalAgents to discover ready Agents in this project, then use the same A2A client tools to send and query tasks. Recipients use A2ALocalTasks/A2ALocalTask to read complete assignments and their reportHandle/generation, then A2AReportTask to explicitly report working, inputRequired, completed or failed. Report only work you actually performed; terminal idleness does not complete a task. A2AInbox reads full messages and pending questions. A2ARooms/A2ARoomContext provide authorized room context. Coordinators use A2ARoomTask for assignment, A2ARoomBrief to update objectives/focus/constraints, and A2ARoomSay for questions and replies. Answering a question does not complete its task. Follow room roles and current task generations. Do not automatically retry mutations with an unknown outcome; read the current task or room first. No collaboration Skill or separate collaboration CLI is required.";

export const A2A_LOCAL_TOOLS = [
  { name: "A2ALocalAgents", description: "Discover other ready local Agents and unsupported sessions in this project. Ready Agents have opaque connection IDs usable with A2AAgentCard/A2ASendMessage/GetTask/CancelTask. Only actual MCP adapter readiness is advertised; an installed or idle CLI alone is insufficient.", inputSchema: object({}), annotations: { readOnlyHint: true } },
  { name: "A2ALocalTasks", description: "List this Recipient instance's valid direct and room assignments, optionally in one room. Returns reportHandle, generation, complete instruction and protocol state without history. If truncated=true, narrow with room or read one task via A2ALocalTask. Use these issued values to report your own work; another Agent's Sender taskHandle is not a report handle.", inputSchema: object({ room: id }), annotations: { readOnlyHint: true } },
  { name: "A2ALocalTask", description: "Read one complete assignment, recent A2A messages and artifacts using a reportHandle issued to this Recipient instance. Read it before acting on a truncated terminal prompt.", inputSchema: object({ reportHandle: id }, ["reportHandle"]), annotations: { readOnlyHint: true } },
  { name: "A2AReportTask", description: "Explicitly report working, inputRequired, completed or failed for your issued reportHandle and current generation. Input-required and failure need explanatory text; completion needs nonempty text or text artifacts. Working reports start/update room task progress. Never infer completion from terminal idleness. The host validates instance, project, role and generation before changing the authoritative task.",
    inputSchema: { ...object({ reportHandle: id, generation, state: { enum: ["working", "inputRequired", "completed", "failed"] }, text, artifacts: strings(artifact, 16) }, ["reportHandle", "generation", "state"]),
      allOf: [{ if: { properties: { state: { enum: ["inputRequired", "failed"] } } }, then: { required: ["text"] } },
        { if: { properties: { state: { const: "completed" } } }, then: { anyOf: [{ required: ["text"] }, { required: ["artifacts"], properties: { artifacts: { minItems: 1 } } }] } }] },
    annotations: { readOnlyHint: false, idempotentHint: false } },
  { name: "A2AInbox", description: "Read your authorized inbox, pending questions and full messages. Omit messageId to list (very large text is truncated and marked textTruncated), or provide a message ID to read its complete text and related replies. Task messages include the current reportHandle/generation. Continue with nextCursor when present; reading or answering does not complete a task.", inputSchema: object({ room: id, messageId: id, cursor: { type: "string", minLength: 1, maxLength: 4096 }, limit: { type: "integer", minimum: 1, maximum: 30 } }), annotations: { readOnlyHint: true } },
  { name: "A2ARooms", description: "List rooms you belong to in this project, your role, their objectives and task counts. Use a returned room ID or name with the room tools. Room membership is verified by the host.", inputSchema: object({}), annotations: { readOnlyHint: true } },
  { name: "A2ARoomContext", description: "Read an authorized room's brief, members, task board with current generations, pending replies and recent messages. Count limits the log to 1–50 entries. Preserve coordinator/member rules; use inbox reading for referenced complete messages.", inputSchema: object({ room: id, count: { type: "integer", minimum: 1, maximum: 50 } }, ["room"]), annotations: { readOnlyHint: true } },
  { name: "A2ARoomSay", description: "Send a room message or explicitly answer questions within the existing role rules. Optional to selects roles/groups; ask/questions require replies. Use replyTo for the original message and answers for each question ID answered, with its topicId. Replying does not complete a task. No acknowledgement is needed for ordinary FYI messages.", inputSchema: object({ room: id, text: roomText, to: strings(id, 64), replyTo: id, ask: { type: "boolean" }, topicId: { type: "string", minLength: 1, maxLength: 256 }, questions: strings(roomText, 32), answers: strings(id, 32) }, ["room", "text"]), annotations: { readOnlyHint: false, idempotentHint: false } },
  { name: "A2ARoomBrief", description: "Update a room's shared objective, current focus or constraints under the existing coordinator permission. Include at least one field to update; omitted fields are preserved. Empty text or an empty constraints array clears that field. The host records and notifies members using the authoritative room brief. Combined text is limited to 64 KiB and at most 64 constraints.",
    inputSchema: { ...object({ room: id, objective: briefText, focus: briefText, constraints: strings(briefText, 64) }, ["room"]), anyOf: [{ required: ["objective"] }, { required: ["focus"] }, { required: ["constraints"] }] },
    annotations: { readOnlyHint: false, idempotentHint: false } },
  { name: "A2ARoomTask", description: "Plan/add, assign, reopen or archive a room task under the existing role permissions. Assigned adds use real local A2A HTTP and can return a Sender taskHandle. For non-add operations include expectedGeneration from A2ARoomContext. Recipients use A2AReportTask for start/progress/result rather than a second completion route. An unassigned planning task is not a delivered task. Never retry automatically after an uncertain send.",
    inputSchema: { ...object({ room: id, op: { oneOf: operations }, expectedGeneration: generation }, ["room", "op"]),
      allOf: [{ if: { properties: { op: { properties: { op: { enum: ["assign", "reopen", "archive"] } } } } }, then: { required: ["expectedGeneration"] } }] },
    annotations: { readOnlyHint: false, idempotentHint: false } },
];
export const A2A_LOCAL_MUTATING_TOOLS = ["A2AReportTask", "A2ARoomSay", "A2ARoomBrief", "A2ARoomTask"];

const invalid = message => { throw apiError("INVALID_ARGUMENT", message); };
function keys(value, allowed) {
  if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid("Unsupported local A2A argument");
}
function string(value, label, maxBytes = 128, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maxBytes) invalid(`Invalid local A2A ${label}`);
}
function integer(value, label, min, max, optional = false) {
  if (optional && value === undefined) return;
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`Invalid local A2A ${label}`);
}
function list(value, label, max, item, optional = true) {
  if (optional && value === undefined) return;
  if (!Array.isArray(value) || value.length > max) invalid(`Invalid local A2A ${label}`);
  value.forEach(item);
}
function name(value, label, max = 120) {
  string(value, label, 512);
  if ([...value].length > max) invalid(`Local A2A ${label} is too long`);
}
function message(value, label) {
  string(value, label, 16000);
  if ([...value].length > 4000) invalid(`Local A2A ${label} exceeds the room message limit`);
}

function argumentsFor(tool, args) {
  const allowed = {
    A2ALocalAgents: [], A2ALocalTasks: ["room"], A2ALocalTask: ["reportHandle"],
    A2AReportTask: ["reportHandle", "generation", "state", "text", "artifacts"],
    A2AInbox: ["room", "messageId", "cursor", "limit"], A2ARooms: [], A2ARoomContext: ["room", "count"],
    A2ARoomSay: ["room", "text", "to", "replyTo", "ask", "topicId", "questions", "answers"],
    A2ARoomBrief: ["room", "objective", "focus", "constraints"],
    A2ARoomTask: ["room", "op", "expectedGeneration"],
  }[tool];
  if (!allowed) invalid("Unknown local A2A tool");
  keys(args, allowed);
  if (allowed.includes("room")) string(args.room, "room", 512, ["A2ALocalTasks", "A2AInbox"].includes(tool));
  if (tool === "A2ALocalTask" || tool === "A2AReportTask") string(args.reportHandle, "reportHandle");
  if (tool === "A2AReportTask") {
    integer(args.generation, "generation", 0, Number.MAX_SAFE_INTEGER);
    if (!["working", "inputRequired", "completed", "failed"].includes(args.state)) invalid("Invalid local A2A report state");
    string(args.text, "text", 65536, true);
    list(args.artifacts, "artifacts", 16, artifact => {
      keys(artifact, ["name", "text"]); string(artifact.text, "artifact text", 65536);
      if (artifact.name !== undefined) name(artifact.name, "artifact name");
    });
    const size = Buffer.byteLength(args.text ?? "", "utf8") + (args.artifacts ?? []).reduce((total, artifact) => total + Buffer.byteLength(artifact.text, "utf8"), 0);
    if (size > 65536) invalid("Local A2A text and artifacts exceed 64 KiB");
    if (["inputRequired", "failed"].includes(args.state) && !args.text?.trim()) invalid("Input-required and failed reports need explanatory text");
    if (args.state === "completed" && !args.text?.trim() && !args.artifacts?.length) invalid("Completed reports need text or artifacts");
  }
  if (tool === "A2AInbox") {
    string(args.messageId, "messageId", 128, true); string(args.cursor, "cursor", 4096, true);
    integer(args.limit, "limit", 1, 30, true);
  }
  if (tool === "A2ARoomContext") integer(args.count, "count", 1, 50, true);
  if (tool === "A2ARoomSay") {
    message(args.text, "text"); string(args.replyTo, "replyTo", 128, true); string(args.topicId, "topicId", 256, true);
    if (args.ask !== undefined && typeof args.ask !== "boolean") invalid("Invalid local A2A ask flag");
    list(args.to, "recipients", 64, value => string(value, "recipient"));
    list(args.questions, "questions", 32, value => message(value, "question"));
    list(args.answers, "answers", 32, value => string(value, "answer ID"));
  }
  if (tool === "A2ARoomBrief") {
    const boundedText = value => {
      if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 65536) invalid("Invalid local A2A brief text");
    };
    for (const field of ["objective", "focus"]) if (args[field] !== undefined) boundedText(args[field]);
    list(args.constraints, "constraints", 64, boundedText);
    if (["objective", "focus", "constraints"].every(field => args[field] === undefined)) invalid("Include a room brief field to update");
    const size = [args.objective ?? "", args.focus ?? "", ...(args.constraints ?? [])].reduce((total, value) => total + Buffer.byteLength(value, "utf8"), 0);
    if (size > 65536) invalid("Local A2A brief text exceeds 64 KiB");
  }
  if (tool === "A2ARoomTask") {
    if (!isObject(args.op)) invalid("Invalid local A2A task operation");
    const fields = { add: ["op", "title", "outcome", "assignee", "after"], assign: ["op", "task", "assignee"], reopen: ["op", "task"], archive: ["op", "task"] }[args.op.op];
    if (!fields) invalid("Use A2AReportTask for recipient progress/results");
    keys(args.op, fields);
    if (args.op.op === "add") {
      name(args.op.title, "task title", 80); string(args.op.outcome, "outcome", 65536, true); string(args.op.assignee, "assignee", 128, true);
      list(args.op.after, "dependencies", 64, value => string(value, "dependency"));
    } else {
      string(args.op.task, "task");
      if (args.op.op === "assign") string(args.op.assignee, "assignee");
    }
    integer(args.expectedGeneration, "expectedGeneration", 0, Number.MAX_SAFE_INTEGER, args.op.op === "add");
  }
  return Object.fromEntries(allowed.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
}

/** A trusted directory handshake, never a model-callable tool. */
export async function localAdapterReady(manager, context) {
  // A CLI may request tools before the newly spawned PTY is bound to its ticket.
  // The single deadline includes host waits and retry pauses. Every attempt
  // still authorizes the native active instance; business mutations never retry.
  activeContext(context);
  const deadline = performance.now() + 2500, timeout = new AbortController();
  const signal = context.abort?.signal ? AbortSignal.any([context.abort.signal, timeout.signal]) : timeout.signal;
  const timer = setTimeout(() => timeout.abort(apiError("TIMEOUT", "Local A2A directory readiness timed out")), 2500);
  let rejectInterrupted;
  const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
  const onAbort = () => rejectInterrupted(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (const pause of [0, 100, 200, 400, 800, 1000]) {
      try {
        if (pause) await delay(pause, undefined, { signal });
        activeContext(context);
        if (signal.aborted || performance.now() >= deadline) return false;
        const value = await Promise.race([a2aPlatformCall(manager, "a2a.localReady", {}, context), interrupted]);
        activeContext(context);
        if (signal.aborted || performance.now() >= deadline) return false;
        if (!isObject(value) || value.protocolVersion !== "1.0") return false;
        if (value.ready === true) return true;
        if (value.reason !== "adapterNotReady") return false;
      } catch (error) {
        // An expired or cancelled request must never receive even an ordinary directory.
        activeContext(context);
        if (signal.aborted || performance.now() >= deadline
          || !["A2A_AGENT_SESSION_INVALID", "A2A_AGENT_SESSION_REQUIRED"].includes(error.code)) return false;
      }
    }
    return false;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

function publicDiscovery(value) {
  if (!isObject(value) || !Array.isArray(value.unsupported)) throw apiError("A2A_INVALID_RESPONSE", "Invalid local A2A discovery");
  return { agents: publicA2AConnections(value.agents).connections, unsupported: value.unsupported.map(agent => {
    if (!isObject(agent) || typeof agent.name !== "string" || typeof agent.agent !== "string" || typeof agent.reason !== "string") throw apiError("A2A_INVALID_RESPONSE", "Invalid local A2A availability");
    return { name: agent.name, agent: agent.agent, reason: agent.reason };
  }) };
}

export async function a2aLocalTool(manager, request, context) {
  try {
    const args = argumentsFor(request.name, request.arguments ?? {});
    // A reattached CLI can call its cached directory without another tools/list.
    // Register only after this actual A2A invocation passes native instance checks.
    const ready = await a2aPlatformCall(manager, "a2a.localReady", {}, context);
    if (!isObject(ready) || ready.ready !== true || ready.protocolVersion !== "1.0") {
      throw apiError("A2A_AGENT_SESSION_REQUIRED", "The local A2A adapter is not ready for this agent connection.");
    }
    const api = { A2ALocalAgents: "a2a.localAgents", A2ALocalTasks: "a2a.localTasks", A2ALocalTask: "a2a.localTask", A2AReportTask: "a2a.localReport", A2AInbox: "a2a.localInbox", A2ARooms: "a2a.localRooms", A2ARoomContext: "a2a.localRoom", A2ARoomSay: "a2a.localRoomSay", A2ARoomBrief: "a2a.localRoomBrief", A2ARoomTask: "a2a.localRoomTask" }[request.name];
    if (["A2AReportTask", "A2ARoomSay", "A2ARoomBrief"].includes(request.name)) args.operationId = randomUUID();
    const value = await a2aPlatformCall(manager, api, args, context, request.name === "A2ARoomTask");
    const result = request.name === "A2ALocalAgents" ? publicDiscovery(value) : value;
    if (!isObject(result)) throw apiError("A2A_INVALID_RESPONSE", "Invalid local A2A host result");
    return { ...textResult(result), structuredContent: result };
  } catch (error) { return a2aErrorResult(error); }
}
