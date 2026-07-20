import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

export function buildCanvasResourceReferences(nodes: CanvasNodeData[], connections: CanvasConnection[], contextNodeId?: string | null) {
    const contextNodes = contextNodeId ? getMentionResourceNodes(contextNodeId, nodes, connections) : [];
    const globalReferences = labelResourceNodes(nodes.filter(isResourceNode), false);
    const activeByNodeId = new Map(labelResourceNodes(contextNodes, true).map((reference) => [reference.nodeId, reference]));
    return globalReferences.map((reference) => activeByNodeId.get(reference.nodeId) || reference);
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const contextNodes = getMentionResourceNodes(node.id, nodes, connections).filter((item) => item.id !== node.id);
    // 未连线的文本/提示词节点也应能引用画布中已有的资源；有连线时仍优先使用当前上下文。
    return labelResourceNodes(contextNodes.length ? contextNodes : nodes.filter((item) => item.id !== node.id && isResourceNode(item)), true);
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const related = new Map<string, CanvasNodeData>();
    const visited = new Set<string>();
    const addResource = (candidate?: CanvasNodeData) => {
        if (candidate && candidate.id !== nodeId && isResourceNode(candidate)) related.set(candidate.id, candidate);
    };

    const visit = (currentId: string) => {
        if (visited.has(currentId)) return;
        visited.add(currentId);
        connections.forEach((connection) => {
            const nextId = connection.fromNodeId === currentId ? connection.toNodeId : connection.toNodeId === currentId ? connection.fromNodeId : null;
            if (!nextId) return;
            const next = nodes.find((item) => item.id === nextId);
            if (!next) return;
            if (next.type === CanvasNodeType.Config) visit(next.id);
            else addResource(next);
        });
    };
    visit(nodeId);

    return Array.from(related.values());
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    return [];
}

function getContextResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((node) => node.id === connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isResourceNode(node)));
}

function getConnectedConfigResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (!configConnection) return [];
    return getContextResourceNodes(configConnection.toNodeId, nodes, connections).filter((node) => node.id !== nodeId);
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const pluginResource = readPluginResource(node);
        const kind = pluginResource?.kind || resourceKind(node);
        if (!kind) return [];
        const index = counts[kind]++;
        const label = node.type === CanvasNodeType.Script ? `脚本${index + 1}` : labelForKind(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                previewUrl: pluginResource?.url || node.metadata?.content || node.metadata?.storageKey,
                text: pluginResource?.text || (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script ? node.metadata?.content || node.metadata?.prompt : undefined),
                active,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    const pluginResource = readPluginResource(node);
    if (pluginResource) return pluginResource.kind;
    if (node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.storageKey)) return "image";
    if (node.type === CanvasNodeType.Video && (node.metadata?.content || node.metadata?.storageKey)) return "video";
    if (node.type === CanvasNodeType.Audio && (node.metadata?.content || node.metadata?.storageKey)) return "audio";
    if ((node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script) && (node.metadata?.content || node.metadata?.prompt)) return "text";
    return null;
}

function readPluginResource(node: CanvasNodeData) {
    try {
        return getNodeDefinition(node.type)?.resource?.(node) || null;
    } catch (error) {
        console.error(`[plugin] 读取节点资源失败: ${node.type}`, error);
        return null;
    }
}
