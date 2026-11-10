// Executable, isolated consumer of the Codex 0.167.0 queue/editor key protocol.
// It records answers by question ID; no shell command or user session is involved.
const questions = [
  { id: "sample-color-1", title: "Which sample color should the isolated preview use?", options: ["Blue sample", "Green sample"] },
  { id: "sample-note-2", title: "Which sample note should the isolated preview show?", options: [] },
  { id: "sample-color-3", title: "Which sample color should the isolated preview use?", options: ["Blue sample", "Green sample"] },
];
let at = 0, expanded = false, selected = 1, draft = "", pending = "", sequence = 0;
const answers = [], opens = [];
const current = () => questions[at];

function screen() {
  const question = current();
  const history = answers.flatMap(answer => [`↪ Re: ${answer.question}`, `  ${answer.text}`, ""]);
  if (!question) return [...history, "Controlled answers received.", "", "› Ask Codex to do anything"].join("\n");
  if (!expanded) return [...history, `? ${question.title}`, ...question.options.map(label => `  • ${label}`), "",
    "◦ Working (14m 11s • esc to interrupt)", "", "• Queued follow-up inputs", "  ? 1 question", "    shift+← to answer", "",
    "› Ask Codex to do anything"].join("\n");
  return [...history, "◦ Working (14m 12s • esc to interrupt)", "", "• Queued follow-up inputs", "", `  ${question.title}`, "",
    ...(question.options.length ? [...question.options, draft || "Other"].map((label, i) => `  ${selected === i + 1 ? "›" : " "} ${i + 1}. ${label.replace(/\n/g, "\n       ")}`)
      : [`  ${draft ? draft.replace(/\n/g, "\n  ") : "Type your answer"}`]),
    "", "  enter submit   ⌃] skip   ⇧→ main prompt"].join("\n");
}

function publish() { process.send({ sequence: ++sequence, stage: !current() ? "done" : expanded ? "editor" : "queued",
  questionId: current()?.id ?? null, screen: screen(), opens, answers }); }
function accept() {
  const question = current();
  if (!expanded || !question) throw new Error("Enter must never be sent to a collapsed question");
  const text = question.options[selected - 1] ?? draft.trim();
  if (!text) return;
  answers.push({ questionId: question.id, question: question.title, text });
  at += 1; expanded = false; selected = 1; draft = "";
}
function type(text) {
  if (!expanded || !current() || (current().options.length && selected <= current().options.length)) throw new Error("Text requires the actual input surface");
  draft += text.replace(/\r/g, "\n");
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", data => {
  pending += data;
  while (pending) {
    if (pending.startsWith("\x1b[200~")) {
      const end = pending.indexOf("\x1b[201~");
      if (end < 0) break;
      type(pending.slice(6, end)); pending = pending.slice(end + 6); continue;
    }
    if (pending.startsWith("\x1b[1;2D")) {
      if (expanded || !current()) throw new Error("The queue editor was opened twice");
      expanded = true; opens.push(current().id); pending = pending.slice(6); continue;
    }
    if (pending.startsWith("\x1b")) {
      const arrow = /^\x1b(?:\[|O)([AB])/.exec(pending);
      if (!arrow) {
        if (["\x1b[1;2D", "\x1b[200~", "\x1b[A", "\x1b[B", "\x1bOA", "\x1bOB"].some(key => key.startsWith(pending))) break;
        throw new Error("Unexpected queue control sequence");
      }
      if (!expanded || !current()?.options.length) throw new Error("No selectable question is open");
      const count = current().options.length + 1;
      selected = (selected - 1 + (arrow[1] === "B" ? 1 : count - 1)) % count + 1;
      pending = pending.slice(arrow[0].length); continue;
    }
    const key = pending[0]; pending = pending.slice(1);
    if (key === "\r") accept(); else type(key);
  }
  publish();
});
process.stdin.on("end", () => process.exit(0));
publish();
