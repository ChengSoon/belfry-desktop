import type { Room, RoomMessage } from "./contracts";
import { labelOf } from "./model";
import { deliveryLabel } from "../collab/taskTone";
import type { DeliveryPhase } from "../collab/api";
import { formatNumber, t } from "../i18n";

export function roomMessageDelivery(room: Room, message: RoomMessage): { label: string; title: string; pending: boolean; uncertain: boolean; submitted: boolean } | null {
  const members = [...new Set(message.to.filter(id => id !== "user" && id !== message.by))];
  if (message.kind !== "chat" || members.length === 0) return null;
  const states = members.map(id => {
    const entry = room.deliveryOutbox?.find(entry => entry.messageId === message.id && entry.memberId === id);
    const phase: DeliveryPhase = message.deliveredTo.includes(id) ? "submitted" : entry?.phase ?? "accepted";
    return { id, phase, reason: entry?.message };
  });
  const priority: DeliveryPhase[] = ["uncertain", "submitting", "queued", "accepted", "cancelled", "submitted"];
  const phase = priority.find(phase => states.some(state => state.phase === phase))!;
  const submitted = states.every(state => state.phase === "submitted");
  return {
    label: submitted ? deliveryLabel("submitted") : t("rooms.delivery.summary", {
      phase: deliveryLabel(phase), count: formatNumber(states.filter(state => state.phase === phase).length), total: formatNumber(states.length),
    }),
    title: states.map(state => `${labelOf(room, state.id)}: ${deliveryLabel(state.phase)}${state.reason ? ` — ${state.reason}` : ""}`).join("\n"),
    pending: states.some(state => !["submitted", "cancelled"].includes(state.phase)), uncertain: phase === "uncertain", submitted,
  };
}
