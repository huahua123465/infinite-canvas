import type { AiTextMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes } from "@/lib/canvas/canvas-resource-references";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections, prompt);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    if ((sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) || /@\[node:[^\]]+\]/.test(prompt)) {
        return buildComposerGenerationContext(inputs, prompt);
    }

    const upstreamText = inputs
        .map((input) => input.text)
        .filter(Boolean)
        .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const mediaInputs = inputs.filter((input) => input.type !== "text");
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    const labelByNodeId = new Map(
        inputs.map((input) => [input.nodeId, generationLabel(input.type, counts[input.type]++)]),
    );
    const textBlocks: string[] = [];
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            const label = labelByNodeId.get(input.nodeId)!;
            if (input.type === "text" && !textBlocks.some((block) => block.startsWith(`【${label}】`))) textBlocks.push(`【${label}】\n${input.text || ""}`);
            nextPrompt += input.type === "text" ? `【${label}】` : `@${label}`;
        }
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    nextPrompt = normalizeComposerReferenceMentions(nextPrompt, counts.image, counts.video, counts.audio);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = mediaInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = mediaInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = mediaInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: textBlocks.length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function normalizeComposerReferenceMentions(prompt: string, imageCount: number, videoCount: number, audioCount: number) {
    let text = prompt;
    ([{ kind: "图片", alias: "image", count: imageCount }, { kind: "视频", alias: "video", count: videoCount }, { kind: "音频", alias: "audio", count: audioCount }] as const).forEach(({ kind, alias, count }) => {
        for (let index = 1; index <= count; index += 1) text = text.replace(new RegExp(`(^|[^@\\w])(?:${kind}|${alias})${index}(?!\\d)`, "gi"), `$1@${kind}${index}`);
    });
    return text;
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt = ""): NodeGenerationInput[] {
    const targetNode = nodes.find((node) => node.id === nodeId);
    const inputNodes = getGenerationResourceNodes(nodeId, nodes, connections).filter((node) => !isStoryboardTailFrameCarrier(node, targetNode));
    const inputIds = new Set(inputNodes.map((node) => node.id));
    const explicitlyMentionedNodeIds = new Set(Array.from(prompt.matchAll(/@\[node:([^\]]+)\]/g)).map((match) => match[1]));
    const explicitlyMentionedNodes = Array.from(explicitlyMentionedNodeIds)
        .map((id) => nodes.find((node) => node.id === id))
        .filter((node): node is CanvasNodeData => Boolean(node && node.id !== nodeId && !inputIds.has(node.id) && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio || node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script)));
    return [...inputNodes, ...explicitlyMentionedNodes].flatMap((node): NodeGenerationInput[] => {
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image }];
        const video = readReferenceVideo(node);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.title, video }];
        const audio = readReferenceAudio(node);
        if (audio) return [{ nodeId: node.id, type: "audio" as const, title: node.title, audio }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text }];
        return [];
    });
}

function isStoryboardTailFrameCarrier(node: CanvasNodeData, targetNode?: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Video || targetNode?.type !== CanvasNodeType.Video || !node.metadata?.storyboardVideoDraftNodeId) return false;
    if (!node.metadata.storyboardVideoTailFrameUrl && !node.metadata.storyboardVideoTailFrameStorageKey) return false;
    const targetRowIndex = targetNode.metadata?.storyboardRowIndex;
    return Boolean(
        targetNode.metadata?.storyboardSourceNodeId
        && node.metadata.storyboardSourceNodeId === targetNode.metadata.storyboardSourceNodeId
        && targetRowIndex !== undefined
        && node.metadata.storyboardRowIndex === targetRowIndex - 1
    );
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function generationLabel(type: NodeGenerationInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    if (type === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || (!node.metadata?.content && !node.metadata?.storageKey)) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content || "",
        storageKey: node.metadata.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || (!node.metadata?.content && !node.metadata?.storageKey)) return null;
    const mimeType = node.metadata.mimeType || "video/mp4";
    const extension = mimeType === "video/webm" ? "webm" : mimeType === "video/quicktime" ? "mov" : "mp4";
    return {
        id: node.id,
        name: `${node.title || node.id}.${extension}`,
        type: mimeType,
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
    };
}
