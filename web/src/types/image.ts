export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    videoReferenceRole?: "reference" | "sceneLock" | "firstFrame" | "lastFrame";
    referenceKind?: "character" | "scene" | "prop";
};
