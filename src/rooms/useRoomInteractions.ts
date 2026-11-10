import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalCommandTarget } from "../terminal/contracts";
import type { TerminalInteraction, TerminalInteractionAnswer, TerminalInteractionOpenResult, TerminalInteractionResult } from "../terminal/interaction";
import type { WorkspaceTab } from "../workspace/contracts";
import type { Room, RoomMember } from "./contracts";
import { activeMembers, memberStatus } from "./model";

export interface RoomInteractionRequest {
  key: string;
  member: RoomMember;
  interaction: TerminalInteraction;
  target?: TerminalCommandTarget;
  legacySignature?: string;
}

interface Sources {
  room: Room;
  tabs: WorkspaceTab[];
  targets?: ReadonlyMap<string, TerminalCommandTarget>;
}

function unknown(sessionId: string): TerminalInteraction {
  return { requestId: "waiting", source: { sessionId, agent: null }, kind: "unknown", question: "", detail: "",
    options: [], selected: null, selectedIndices: [], input: null, state: "pending" };
}

function readRequests({ room, tabs, targets }: Sources): RoomInteractionRequest[] {
  const requests: RoomInteractionRequest[] = [];
  for (const member of activeMembers(room)) {
    const tab = tabs.find(tab => tab.id === member.tabId);
    const status = memberStatus(tab);
    if (!tab || status === "offline") continue;
    const target = targets?.get(member.tabId);
    let interaction: TerminalInteraction | null = null;
    let legacySignature: string | undefined;
    try {
      if (target?.readInteraction) {
        // An available request is sufficient, even if activity has not caught up.
        // A null result means it closed; stale activity must not resurrect it.
        interaction = target.readInteraction();
      } else if (status === "waiting") {
        const choice = target?.readChoice?.();
        const sessionId = target?.getSessionId?.() ?? member.tabId;
        if (choice) {
          legacySignature = choice.signature;
          interaction = { ...choice, requestId: choice.signature, source: { sessionId, agent: null },
            kind: "single", selectedIndices: [], input: null, state: "pending" };
        } else interaction = unknown(sessionId);
      }
    } catch {
      // Keep the terminal reachable if its reader is temporarily unavailable.
      if (status === "waiting") interaction = unknown(member.tabId);
    }
    if (!interaction) continue;
    const key = JSON.stringify([room.id, member.id, member.tabId, interaction.source.sessionId, interaction.requestId]);
    requests.push({ key, member, target, legacySignature, interaction: { ...interaction,
      source: { ...interaction.source }, options: interaction.options.map(option => ({ ...option })),
      selectedIndices: [...interaction.selectedIndices], input: interaction.input ? { ...interaction.input } : null,
      ...(interaction.queue ? { queue: { ...interaction.queue } } : {}) } });
  }
  return requests;
}

/** Presentation snapshots stay tied to a member, terminal session and request. */
export function useRoomInteractions(sources: Sources) {
  const latest = useRef(sources);
  latest.current = sources;
  const mounted = useRef(true);
  const opening = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [snapshot, setSnapshot] = useState<{ roomId: string; fingerprint: string; requests: RoomInteractionRequest[] }>(
    { roomId: sources.room.id, fingerprint: "", requests: [] },
  );
  const refresh = useCallback(() => {
    if (!mounted.current) return [];
    const current = latest.current;
    const requests = readRequests(current);
    // Cursor, checked items and submission state can change without a new ID.
    const fingerprint = JSON.stringify(requests.map(({ key, member, interaction }) => [key, member.title, interaction]));
    setSnapshot(previous => previous.roomId === current.room.id && previous.fingerprint === fingerprint
      && requests.every((request, i) => request.legacySignature === undefined || request.target === previous.requests[i]?.target)
      ? previous : { roomId: current.room.id, requests, fingerprint });
    return requests;
  }, []);
  const membership = JSON.stringify(activeMembers(sources.room).map(member => [member.id, member.tabId,
    memberStatus(sources.tabs.find(tab => tab.id === member.tabId))]));
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => window.clearInterval(timer);
  }, [sources.room.id, membership, sources.targets, refresh]);

  const answer = useCallback(async (request: RoomInteractionRequest, reply: TerminalInteractionAnswer): Promise<TerminalInteractionResult> => {
    // Check current membership and the current target at the moment of the click.
    // Replacing a room/session must never redirect an old rendered button.
    const current = refresh().find(candidate => candidate.key === request.key);
    if (!current) return { status: "changed" };
    if (current.interaction.state === "submitting" || current.interaction.state === "opening") return { status: "busy" };
    if (current.interaction.state === "submitted") return { status: "changed" };
    if (current.interaction.state === "uncertain") return { status: "uncertain" };
    if (reply.kind === "single" && current.interaction.options.some(option => option.index === reply.index && option.action === "input")) {
      return { status: "invalid" };
    }
    try {
      if (current.target?.getSessionId && current.target.getSessionId() !== current.interaction.source.sessionId) return { status: "changed" };
      if (current.legacySignature !== undefined) {
        if (current.target !== request.target || reply.kind !== "single") return { status: "changed" };
        return { status: current.target?.answerChoice?.(current.legacySignature, reply.index) ?? "unavailable" };
      }
      if (!current.target?.answerInteraction || current.interaction.kind === "unknown" || current.interaction.kind === "queued") return { status: "unavailable" };
      return await current.target.answerInteraction(current.interaction.requestId, reply);
    } catch {
      // A rejected transport cannot prove whether it wrote before failing.
      return { status: "uncertain" };
    } finally {
      refresh();
    }
  }, [refresh]);

  const open = useCallback(async (request: RoomInteractionRequest, optionIndex?: number): Promise<TerminalInteractionOpenResult> => {
    const roomId = latest.current.room.id;
    const current = refresh().find(candidate => candidate.key === request.key);
    if (!current) return { status: "changed" };
    if (opening.current.has(request.key) || current.interaction.state === "opening"
      || current.interaction.state === "submitting") return { status: "busy" };
    if (current.interaction.state === "uncertain") return { status: "uncertain" };
    const canOpen = optionIndex === undefined ? current.interaction.kind === "queued"
      : (current.interaction.kind === "single" || current.interaction.kind === "confirmation")
        && current.interaction.options.some(option => option.index === optionIndex && option.action === "input");
    if (current.interaction.state !== "pending" || !canOpen) return { status: "changed" };
    const target = current.target;
    if (!target?.openInteraction) return { status: "unavailable" };
    opening.current.add(request.key);
    try {
      const sessionId = current.interaction.source.sessionId;
      if (target.getSessionId && target.getSessionId() !== sessionId) return { status: "changed" };
      const result = optionIndex === undefined ? await target.openInteraction(current.interaction.requestId)
        : await target.openInteraction(current.interaction.requestId, optionIndex);
      if (result.status !== "opened") return result;
      // Opening is not an answer. Only adopt the newly observed request from
      // this same room, member and terminal; a late receipt cannot redirect it.
      const key = JSON.stringify([roomId, request.member.id, request.member.tabId, sessionId, result.requestId]);
      const next = refresh().find(candidate => candidate.key === key);
      if (!next || next.target !== target || next.interaction.kind === "queued"
        || result.requestId === current.interaction.requestId
        || (target.getSessionId && target.getSessionId() !== sessionId)) return { status: "changed" };
      return result;
    } catch {
      return { status: "uncertain" };
    } finally {
      opening.current.delete(request.key);
      refresh();
    }
  }, [refresh]);

  const requests = snapshot.roomId === sources.room.id ? snapshot.requests.filter(request =>
    activeMembers(sources.room).some(member => member.id === request.member.id && member.tabId === request.member.tabId)
    && memberStatus(sources.tabs.find(tab => tab.id === request.member.tabId)) !== "offline") : [];
  return { requests, answer, open };
}
