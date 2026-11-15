import { Globe, Users, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import { t, useTranslation } from "../i18n";
import type { ProjectWorkspace } from "../workspace/contracts";
import { NodeAvatar } from "./kit";
import { peerStatusText, visiblePeers, type Peer } from "./peers";

type NodeState = "ready" | "warn" | "idle";
type Side = "left" | "right";

interface FieldNode {
  key: string;
  name: string;
  kind: Peer["kind"];
  state: NodeState;
  peer?: Peer;
  overflow?: number;
}
interface PlacedNode { node: FieldNode; side: Side; x: number; y: number }

/** Vertical slots in percent; four nodes still leave room for their captions. */
const SLOTS: Record<number, number[]> = { 1: [50], 2: [34, 66], 3: [24, 50, 76], 4: [17, 39, 61, 83] };

function sideNodes(peers: Peer[], kind: Peer["kind"]): FieldNode[] {
  const { shown, hidden } = visiblePeers(peers, kind);
  return [
    ...shown.map(peer => ({ key: peer.key, name: peer.name, kind, state: peer.state, peer })),
    ...(hidden.length ? [{ key: `more:${kind}`, name: `+${hidden.length}`, kind, state: "idle" as const, overflow: hidden.length }] : []),
  ];
}

function place(nodes: FieldNode[], side: Side): PlacedNode[] {
  const ys = SLOTS[Math.min(nodes.length, 4)] ?? [];
  return nodes.map((node, index) => ({ node, side, x: side === "left" ? 22 : 78, y: ys[index] ?? 50 }));
}

function linkPath({ x, y }: { x: number; y: number }) {
  const bend = x < 50 ? 36 : 64;
  return `M 50 50 C ${bend} 50, ${bend} ${y}, ${x} ${y}`;
}

/**
 * The panel's primary surface: project hub in the middle, local sessions on the
 * left orbit and external services on the right. Nodes are real buttons; the
 * selected peer is inspected in one card below the map.
 */
export function LinkField({ project, peers, selected, onSelect }: {
  project: ProjectWorkspace; peers: Peer[]; selected: string | null; onSelect: (key: string) => void;
}) {
  useTranslation();
  const local = sideNodes(peers, "local"), external = sideNodes(peers, "external");
  const localTotal = peers.filter(peer => peer.kind === "local").length;
  const externalTotal = peers.filter(peer => peer.kind === "external").length;
  const placed = [...place(local, "left"), ...place(external, "right")];

  const label = (node: FieldNode) => node.overflow
    ? t("a2a.workspace.morePeers", { count: node.overflow })
    : `${node.name} · ${t(node.kind === "external" ? "a2a.workspace.external" : "a2a.local.title")} · ${peerStatusText(node.peer!)}`;

  return <div className="a2a-map__canvas" role="group" aria-label={t("a2a.workspace.overview")}>
    <span className="a2a-map__side is-local">{t("a2a.local.title")}<b>{localTotal}</b></span>
    <span className="a2a-map__side is-external">{t("a2a.workspace.external")}<b>{externalTotal}</b></span>
    <svg className="a2a-map__links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {placed.map(({ node, x, y }, index) => {
        const path = linkPath({ x, y });
        return <g key={`${node.key}:${x}`}>
          <path className="a2a-link" data-state={node.state} data-selected={selected === node.key ? "" : undefined}
            d={path} vectorEffect="non-scaling-stroke" />
          {node.state === "ready" ? <path className="a2a-link__pulse" d={path} pathLength={100}
            style={{ animationDelay: `${index * -0.9}s` }} vectorEffect="non-scaling-stroke" /> : null}
        </g>;
      })}
    </svg>
    {local.length === 0 ? <FieldSlot x={22} y={50} caption="0"
      avatar={<NodeAvatar name="local" size="md" state="idle" ghost><Users size={14} /></NodeAvatar>} /> : null}
    {external.length === 0 ? <FieldSlot x={78} y={50} caption="0"
      avatar={<NodeAvatar name="external" size="md" state="idle" ghost><Globe size={14} /></NodeAvatar>} /> : null}
    <div className="a2a-map-node a2a-map-node--project" style={{ left: "50%", top: "50%" }}>
      <span className="a2a-hub" aria-hidden="true"><Waypoints size={18} /></span>
      <span className="a2a-map-node__caption" title={project.name}>{project.name}</span>
    </div>
    {placed.map(({ node, x, y }) => <button key={`${node.key}:${x}`} type="button" className="a2a-map-node"
      data-kind={node.kind} data-selected={selected === node.key ? "" : undefined} aria-pressed={selected === node.key}
      aria-label={label(node)} title={label(node)} style={{ left: `${x}%`, top: `${y}%` }}
      onClick={() => onSelect(node.key)}>
      <NodeAvatar name={node.name} size="md" state={node.state} ghost={!!node.overflow}>
        {node.overflow ? node.name : undefined}
      </NodeAvatar>
      <span className="a2a-map-node__caption" aria-hidden="true">{node.name}</span>
    </button>)}
  </div>;
}

function FieldSlot({ x, y, caption, avatar }: { x: number; y: number; caption: string; avatar: ReactNode }) {
  return <div className="a2a-map-node" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true">
    {avatar}<span className="a2a-map-node__caption">{caption}</span>
  </div>;
}
