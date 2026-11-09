import { AlertCircle, ChevronDown, SendHorizontal, SquareTerminal } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Kbd } from "../../components/ui/kbd";
import { Spinner } from "../../components/ui/spinner";
import { Textarea } from "../../components/ui/textarea";
import { t, useTranslation } from "../../i18n";
import type { TerminalInteractionAnswer, TerminalInteractionResult } from "../../terminal/interaction";
import { composingKey } from "../../utils/keyboard";
import type { RoomInteractionRequest } from "../useRoomInteractions";

function resultText(result: TerminalInteractionResult) {
  switch (result.status) {
    case "sent": return t("rooms.choice.sent");
    case "changed": return t("rooms.choice.changed");
    case "unavailable": return t("rooms.choice.unavailable");
    case "busy": return t("rooms.choice.busy");
    case "invalid": return t("rooms.choice.invalid");
    case "failed": return t("rooms.choice.failed");
    case "uncertain": return t("rooms.choice.uncertain");
  }
}

export function RoomChoiceCard({ request, avatar, onAnswer, onOpenSession }: {
  request: RoomInteractionRequest;
  avatar: ReactNode;
  onAnswer: (request: RoomInteractionRequest, answer: TerminalInteractionAnswer) => Promise<TerminalInteractionResult>;
  onOpenSession?: (tabId: string) => void;
}) {
  useTranslation();
  const id = useId();
  const { member, interaction } = request;
  const [indices, setIndices] = useState(interaction.selectedIndices);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TerminalInteractionResult | null>(null);
  const submitting = useRef(false);
  const dirty = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const checked = JSON.stringify(interaction.selectedIndices);
  useEffect(() => {
    if (!dirty.current) setIndices(JSON.parse(checked) as number[]);
  }, [checked]);

  const state = pending ? "submitting" : result?.status === "sent" ? "submitted"
    : result?.status === "uncertain" ? "uncertain" : interaction.state;
  const disabled = state !== "pending";
  const emptyRequired = interaction.kind === "input" && !interaction.input?.optional && !text.trim();
  const submit = async (reply: TerminalInteractionAnswer) => {
    if (submitting.current || disabled || (reply.kind === "input" && !interaction.input?.optional && !reply.text.trim())) return;
    submitting.current = true;
    setPending(true);
    setResult(null);
    try {
      const next = await onAnswer(request, reply);
      if (mounted.current) setResult(next);
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (composingKey(event) || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  const hasError = result && !["sent", "busy"].includes(result.status);

  return (
    <article className="room-choice-card" data-member-id={member.id} data-request-kind={interaction.kind} data-request-state={state}
      aria-labelledby={`${id}-question`}>
      <header className="room-choice-heading">
        {avatar}
        <span className="room-choice-member">{member.title}</span>
        <span className="room-choice-state" data-state={state}>
          {state === "submitting" ? <Spinner className="size-3" /> : <span className="room-choice-state-dot" aria-hidden="true" />}
          {state === "submitting" ? t("rooms.choice.submitting") : state === "submitted" ? t("rooms.choice.submitted")
            : state === "uncertain" ? t("rooms.choice.checkTerminal") : t("rooms.choice.pending")}
        </span>
        {onOpenSession ? <Button className="room-choice-terminal" size="icon-xs" variant="ghost"
          aria-label={t("rooms.choice.openTerminal", { name: member.title })} title={t("rooms.choice.openTerminal", { name: member.title })}
          onClick={() => onOpenSession(member.tabId)}><SquareTerminal /></Button> : null}
      </header>
      <h3 className="room-choice-question" id={`${id}-question`}>{interaction.question || t("rooms.choice.waitingQuestion")}</h3>
      {interaction.detail ? (
        <details className="room-choice-details">
          <summary><ChevronDown className="size-3.5" />{t("rooms.choice.details")}</summary>
          <pre tabIndex={0} aria-label={t("rooms.choice.details")}>{interaction.detail}</pre>
        </details>
      ) : null}
      {interaction.kind === "unknown" ? <p className="room-choice-help">{t("rooms.choice.unsupported")}</p> : null}
      {interaction.kind === "single" || interaction.kind === "confirmation" ? (
        <div className="room-choice-options" role="group" aria-labelledby={`${id}-question`} onKeyDown={moveFocus}>
          <span className="sr-only" id={`${id}-current`}>{t("rooms.choice.currentItem")}</span>
          {interaction.options.map(option => (
            <Button type="button" className="room-choice-option" variant="ghost" key={option.index} disabled={disabled}
              data-option-index={option.index} data-current={option.index === interaction.selected}
              aria-current={option.index === interaction.selected ? true : undefined}
              aria-labelledby={`${id}-option-${option.index}`} aria-describedby={[
                option.description ? `${id}-description-${option.index}` : "", option.index === interaction.selected ? `${id}-current` : "",
              ].filter(Boolean).join(" ") || undefined}
              onClick={() => void submit({ kind: "single", index: option.index })}>
              <Kbd aria-hidden="true">{option.index}</Kbd>
              <span className="room-choice-option-copy">
                <span className="room-choice-option-title" id={`${id}-option-${option.index}`}>{option.label}</span>
                {option.description ? <span className="room-choice-option-description" id={`${id}-description-${option.index}`}>{option.description}</span> : null}
              </span>
              <span className="room-choice-current-dot" aria-hidden="true" />
            </Button>
          ))}
        </div>
      ) : null}
      {interaction.kind === "multiple" ? (
        <form onSubmit={event => { event.preventDefault(); void submit({ kind: "multiple", indices }); }}>
          <p className="room-choice-help">{t("rooms.choice.multipleHint")}</p>
          <div className="room-choice-options" role="group" aria-labelledby={`${id}-question`}>
            {interaction.options.map(option => (
              <label className="room-choice-option" data-current={option.index === interaction.selected} key={option.index}>
                <Checkbox checked={indices.includes(option.index)} disabled={disabled}
                  aria-labelledby={`${id}-option-${option.index}`} aria-describedby={option.description ? `${id}-description-${option.index}` : undefined}
                  onCheckedChange={value => {
                    dirty.current = true;
                    setIndices(current => value === true ? [...new Set([...current, option.index])].sort((a, b) => a - b) : current.filter(index => index !== option.index));
                  }} />
                <span className="room-choice-option-copy">
                  <span className="room-choice-option-title" id={`${id}-option-${option.index}`}>{option.label}</span>
                  {option.description ? <span className="room-choice-option-description" id={`${id}-description-${option.index}`}>{option.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <div className="room-choice-submit"><Button type="submit" size="sm" disabled={disabled}><SendHorizontal />{t("rooms.choice.submitSelection")}</Button></div>
        </form>
      ) : null}
      {interaction.kind === "input" ? (
        <form className="room-choice-input" onSubmit={event => { event.preventDefault(); void submit({ kind: "input", text }); }}>
          <label htmlFor={`${id}-answer`}>{interaction.input?.label || t("rooms.choice.answerLabel")}
            {interaction.input?.optional ? <span className="room-choice-optional"> {t("rooms.choice.optional")}</span> : null}
          </label>
          <Textarea id={`${id}-answer`} value={text} rows={2} disabled={disabled} placeholder={interaction.input?.placeholder}
            aria-required={!interaction.input?.optional}
            onChange={event => setText(event.target.value)} onKeyDown={event => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !composingKey(event)) {
                event.preventDefault(); void submit({ kind: "input", text });
              }
            }} />
          <div className="room-choice-submit"><Button type="submit" size="sm" disabled={disabled || emptyRequired}><SendHorizontal />{t("rooms.choice.submitAnswer")}</Button></div>
        </form>
      ) : null}
      {interaction.optionsComplete === false && interaction.kind !== "unknown" ? (
        <p className="room-choice-help">
          {onOpenSession ? <Button type="button" size="xs" variant="link" className="h-auto justify-start px-0 text-left whitespace-normal"
            onClick={() => onOpenSession(member.tabId)}>{t("rooms.choice.moreOptions")}</Button> : t("rooms.choice.moreOptions")}
        </p>
      ) : null}
      {result || state === "uncertain" ? (
        <div className="room-choice-feedback" data-error={Boolean(hasError || state === "uncertain")}
          role={hasError || state === "uncertain" ? "alert" : "status"}>
          {hasError || state === "uncertain" ? <AlertCircle className="size-3.5" /> : null}
          <div><p>{result ? resultText(result) : t("rooms.choice.uncertain")}</p>{result?.message ? <p>{result.message}</p> : null}</div>
        </div>
      ) : null}
    </article>
  );
}
