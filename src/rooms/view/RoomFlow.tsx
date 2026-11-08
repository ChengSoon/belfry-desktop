import {
  Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, Position, ReactFlow,
  ReactFlowProvider, useNodesInitialized, useReactFlow, useStore, type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Crown, SquareTerminal, User } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { useTheme } from "../../theme/ThemeProvider";
import type { WorkspaceTab } from "../../workspace/contracts";
import type { Room } from "../contracts";
import { flowGraph, type FlowEdge, type FlowNode, type FlowSide, type FlowTone } from "../flow";
import { hueOf, initialOf, MEMBER_STATUS_TEXT, memberStatus } from "../model";

/**
 * 协作流程图：你 → 统筹 → 各位成员。连线上写着谁手上有什么活，正在做的、刚有消息的、在等你的会动起来。
 *
 * 用 React Flow（xyflow，MIT）画：缩放、平移、适配视野都是它的；这里只管节点和连线长什么样。
 */

const NODE_WIDTH = 232;
const NODE_HEIGHT = 64;
/** 「刚有消息」按这个节奏重新算一遍，过了时间的连线自己暗下去。 */
const TICK_MS = 15_000;

// React Flow 要求 data 是普通对象（带字符串索引）。
type MemberNodeData = FlowNode & { onOpenSession?: (tabId: string) => void } & Record<string, unknown>;
type FlowEdgeData = Pick<FlowEdge, "tone" | "label" | "animated"> & Record<string, unknown>;

const POSITION: Record<FlowSide, Position> = {
  top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left,
};
const SIDES: FlowSide[] = ["top", "right", "bottom", "left"];

const STATUS_DOT = {
  user: "bg-primary",
  idle: "bg-success",
  busy: "bg-primary",
  waiting: "bg-warning",
  offline: "bg-muted-foreground/40",
} as const;

const MemberNode = memo(function MemberNode({ data }: NodeProps<Node<MemberNodeData>>) {
  const node = data;
  const statusText = node.status === "user" ? null : node.status === "busy" ? "处理中" : MEMBER_STATUS_TEXT[node.status];
  return (
    <div
      className={cn(
        "room-flow-node group relative flex items-center gap-2.5 rounded-xl border bg-card px-3 shadow-sm transition-[border-color,box-shadow]",
        node.kind === "foreman" ? "border-primary/60" : "border-border",
        node.status === "busy" && "room-flow-node--busy border-primary/70",
        node.status === "waiting" && "room-flow-node--waiting border-warning",
        node.status === "offline" && "opacity-60",
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      title={node.subtitle}>
      {SIDES.map((side) => (
        <Handle className="room-flow-handle" id={`s-${side}`} isConnectable={false} key={`s-${side}`} position={POSITION[side]} type="source" />
      ))}
      {SIDES.map((side) => (
        <Handle className="room-flow-handle" id={`t-${side}`} isConnectable={false} key={`t-${side}`} position={POSITION[side]} type="target" />
      ))}
      <span className="relative inline-flex shrink-0">
        <Avatar>
          <AvatarFallback
            className={cn("font-semibold", node.kind === "user" ? "bg-primary text-primary-foreground" : "room-avatar")}
            style={node.kind === "user" ? undefined : { "--avatar-hue": hueOf(node.id) } as React.CSSProperties}>
            {node.kind === "user" ? <User className="size-4" /> : initialOf(node.title)}
          </AvatarFallback>
        </Avatar>
        <span aria-hidden="true" className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card",
          STATUS_DOT[node.status])} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className={cn("truncate font-semibold", node.status === "waiting" && "text-warning")}>{node.title}</span>
          {node.kind === "foreman" ? <Crown aria-label="统筹" className="size-3.5 shrink-0 text-warning" /> : null}
          {node.load ? (
            <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary tabular-nums" title={`手上 ${node.load} 件`}>
              {node.load}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {statusText ? <span className={cn(node.status === "waiting" && "font-medium text-warning", node.status === "busy" && "text-primary")}>
            {node.status === "busy" ? <span aria-hidden="true" className="room-flow-activity"><i /><i /><i /></span> : null}
            {statusText}
          </span> : null}
          {node.subtitle ? <>{statusText ? " · " : ""}{node.subtitle}</> : null}
        </span>
      </span>
      {node.tabId && data.onOpenSession ? (
        <Button aria-label={`打开 ${node.title} 的终端`} className="nodrag nopan absolute -top-2.5 -right-2.5 size-6 rounded-full border border-border opacity-0 shadow-sm group-hover:opacity-100"
          onClick={() => data.onOpenSession?.(node.tabId!)} size="icon-xs" title="打开终端" variant="secondary">
          <SquareTerminal className="size-3" />
        </Button>
      ) : null}
    </div>
  );
});

const TONE_STROKE: Record<FlowTone, string> = {
  active: "var(--accent)",
  message: "var(--accent)",
  waiting: "var(--warning)",
  reply: "var(--warning)",
  idle: "var(--border-strong)",
};

const FlowLine = memo(function FlowLine(props: EdgeProps<Edge<FlowEdgeData>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.35 });
  const tone = data?.tone ?? "idle";
  const stroke = TONE_STROKE[tone];
  const strong = tone !== "idle";
  return (
    <>
      {strong ? <BaseEdge path={path} style={{ stroke, strokeWidth: 8, opacity: 0.12 }} /> : null}
      <BaseEdge className={cn(data?.animated && "room-flow-edge--animated", tone === "reply" && "room-flow-edge--dashed")}
        path={path} style={{ stroke, strokeWidth: strong ? 2 : 1.25, opacity: strong ? 1 : 0.7 }} />
      {data?.animated ? [0, 1].map((index) => (
        <circle className="room-flow-pulse" fill={stroke} key={index} opacity={index ? 0.55 : 1} r={index ? 2.5 : 3.5} style={{ color: stroke }}>
          <animateMotion begin={`${index * (tone === "message" ? -0.8 : -1.2)}s`} dur={tone === "message" ? "1.6s" : "2.4s"} path={path} repeatCount="indefinite" />
        </circle>
      )) : null}
      {data?.label ? (
        <EdgeLabelRenderer>
          <span className={cn(
            "nodrag nopan pointer-events-auto absolute rounded-full border px-2 py-0.5 text-[11px] font-medium shadow-xs",
            tone === "waiting" || tone === "reply" ? "border-warning/50 bg-card text-warning"
              : strong ? "border-primary/40 bg-card text-primary" : "border-border bg-card text-muted-foreground",
          )} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

const nodeTypes = { member: MemberNode };
const edgeTypes = { flow: FlowLine };

function FlowCanvas({ room, tabs, onOpenSession }: { room: Room; tabs: WorkspaceTab[]; onOpenSession?: (tabId: string) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const flow = useReactFlow();
  const { mode } = useTheme();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const lastAt = room.messages.at(-1)?.at;
  useEffect(() => setNow(Date.now()), [lastAt]);

  const graph = useMemo(
    () => flowGraph(room, (member) => memberStatus(tabs.find((tab) => tab.id === member.tabId)), now),
    [room, tabs, now],
  );
  const nodes = useMemo<Node<MemberNodeData>[]>(() => graph.nodes.map((node) => ({
    id: node.id,
    type: "member",
    position: { x: node.x - NODE_WIDTH / 2, y: node.y - NODE_HEIGHT / 2 },
    data: { ...node, onOpenSession },
    draggable: false,
    selectable: false,
  })), [graph.nodes, onOpenSession]);
  const edges = useMemo<Edge<FlowEdgeData>[]>(() => graph.edges.map((edge) => ({
    id: edge.id,
    type: "flow",
    source: edge.source,
    target: edge.target,
    sourceHandle: `s-${edge.sourceSide}`,
    targetHandle: `t-${edge.targetSide}`,
    data: { tone: edge.tone, label: edge.label, animated: edge.animated },
    selectable: false,
  })), [graph.edges]);

  // 节点量好尺寸、成员进出、画布变大变小（上面冒出选择卡片）时重新框住全图。
  // 只在这几种时候框：平时成员状态变化不动用户缩放好的视野。
  const initialized = useNodesInitialized();
  const size = useStore((state) => `${Math.round(state.width)}x${Math.round(state.height)}`);
  const layoutKey = graph.nodes.map((node) => node.id).join(",");
  useEffect(() => {
    if (!initialized) return;
    const frame = requestAnimationFrame(() => void flow.fitView({ padding: 0.15, duration: 150, maxZoom: 1.1 }));
    return () => cancelAnimationFrame(frame);
  }, [initialized, layoutKey, room.id, size, flow]);

  return (
    <ReactFlow
      className="room-flow" colorMode={mode} edges={edges} edgeTypes={edgeTypes} fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }} maxZoom={1.75} minZoom={0.3} nodes={nodes} nodesConnectable={false}
      nodesDraggable={false} nodeTypes={nodeTypes} proOptions={{ hideAttribution: true }}>
      <Background color="var(--border)" gap={24} size={1.25} variant={BackgroundVariant.Dots} />
      <Controls className="room-flow-controls" position="bottom-left" showInteractive={false} />
      <FlowLegend />
    </ReactFlow>
  );
}

function FlowLegend() {
  const items: { tone: FlowTone; label: string }[] = [
    { tone: "active", label: "处理中" },
    { tone: "message", label: "刚有消息" },
    { tone: "waiting", label: "等你 / 等回复" },
    { tone: "idle", label: "空闲 / 离线" },
  ];
  return (
    <div className="absolute right-3 bottom-3 z-10 flex items-center gap-3 rounded-lg border border-border bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
      {items.map((item) => (
        <span className="flex items-center gap-1.5" key={item.tone}>
          <span className="h-0.5 w-4 rounded-full" style={{ background: TONE_STROKE[item.tone], opacity: item.tone === "idle" ? 0.7 : 1 }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function RoomFlow(props: { room: Room; tabs: WorkspaceTab[]; onOpenSession?: (tabId: string) => void }) {
  return (
    <div aria-label="协作流程" className="relative min-h-0 flex-1" role="figure">
      <ReactFlowProvider>
        <FlowCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
