// Controlled terminal consumer for execution-level tests. No commands are executed.
let stage = 0, selected = 1, text = "", pending = "", sequence = 0;
const checked = new Set([1, 3]), answers = [];

function screen() {
  if (stage === 0) return ["Would you like to run the following command?", "", "$ printf controlled-fixture", "",
    `${selected === 1 ? "›" : " "} 1. Yes, proceed`, `${selected === 2 ? "›" : " "} 2. No, cancel`, "", "Press enter to confirm or esc to cancel"].join("\n");
  if (stage === 1) return ["Status line", "", "Type to search", "",
    ...["Model", "Tokens", "Branch"].map((label, at) => `${selected === at + 1 ? "›" : " "} [${checked.has(at + 1) ? "x" : " "}] ${label}`),
    "", "space toggle · enter save · esc cancel"].join("\n");
  if (stage === 2) return ["Question 1/1 (1 unanswered)", "Share details.", "",
    `› ${text ? text.replace(/\n/g, "\n  ") : "Type your answer (optional)"}`, "", "enter to submit answer | esc to interrupt"].join("\n");
  return "Answer received.";
}

function publish() { process.send({ sequence: ++sequence, screen: screen(), answers }); }
function enter() {
  if (stage === 0) { answers.push({ kind: "confirmation", index: selected }); selected = 2; }
  else if (stage === 1) answers.push({ kind: "multiple", indices: [...checked].sort() });
  else if (stage === 2) answers.push({ kind: "input", text });
  stage += 1;
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", data => {
  pending += data;
  while (pending) {
    if (pending.startsWith("\x1b[200~")) {
      const end = pending.indexOf("\x1b[201~");
      if (end < 0) break;
      if (stage === 2) text += pending.slice(6, end).replace(/\r/g, "\n");
      pending = pending.slice(end + 6);
      continue;
    }
    if (pending.startsWith("\x1b")) {
      if (pending.length < 3) break;
      const arrow = /^\x1b(?:\[|O)([AB])/.exec(pending);
      if (!arrow) throw new Error("Unexpected fixture control sequence");
      selected = Math.max(1, Math.min(stage === 0 ? 2 : 3, selected + (arrow[1] === "B" ? 1 : -1)));
      pending = pending.slice(arrow[0].length);
      continue;
    }
    const key = pending[0]; pending = pending.slice(1);
    if (key === "\r") enter();
    else if (key === " " && stage === 1) checked.has(selected) ? checked.delete(selected) : checked.add(selected);
    else if (stage === 2) text += key;
    else throw new Error("Unexpected fixture input");
  }
  publish();
});
process.stdin.on("end", () => process.exit(0));
publish();
