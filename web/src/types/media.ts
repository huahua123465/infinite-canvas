export type ReferenceVideo = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
};

export type ReferenceAudio = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey?: string;
    durationMs?: number;
};

export type ApimartAvatarMode = "identity-lock" | "ordinary";

export type VideoRequestReferenceSummary = {
    order: number;
    mediaType: "image" | "video" | "audio";
    name: string;
    role: "character" | "scene" | "prop" | "firstFrame" | "lastFrame" | "reference";
    mimeType?: string;
    source: "stored" | "inline" | "remote" | "unknown";
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
};

export type VideoRequestSummary = {
    model: string;
    promptLength: number;
    promptSha256: string;
    parameters: Record<string, string | number | boolean>;
    references: VideoRequestReferenceSummary[];
};
