import type { ImageCropRect } from "./canvas-image-data";

export type MultiViewNodeType = "front" | "top" | "left" | "right";

export type MultiViewNodeSpec = {
    key: MultiViewNodeType;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    crop: ImageCropRect;
};

export const MULTI_VIEW_NODE_SPECS: MultiViewNodeSpec[] = [
    { key: "front", label: "Front View", x: 0, y: 0, width: 280, height: 158, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } },
    { key: "top", label: "Top-down View", x: 320, y: 0, width: 280, height: 158, crop: { x: 0.5, y: 0, width: 0.5, height: 0.5 } },
    { key: "left", label: "Left Side View", x: 0, y: 198, width: 280, height: 158, crop: { x: 0, y: 0.5, width: 0.5, height: 0.5 } },
    { key: "right", label: "Right Side View", x: 320, y: 198, width: 280, height: 158, crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } },
];

export function prepareMultiViewPrompt(importedPrompt: string) {
    return `(2x2 split screen grid, multi-view:1.3), 4 different angles of the same scene, consistent architecture and elements, ${importedPrompt}, top-left is front view, top-right is top-down view, bottom-left is left side view, bottom-right is right side view, photorealistic, ultra detailed --ar 16:9`;
}
