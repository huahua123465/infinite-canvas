import { nanoid } from "nanoid";

import { uploadImage } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type ViewportTransform } from "@/types/canvas";
import { fitNodeSize } from "./canvas-node-size";

export type DirectorDeskCaptureImport = {
    dataUrl: string;
    fileName: string;
};

const DEFAULT_VIEWPORT_SIZE = { width: 1200, height: 720 };
const CAPTURE_GRID_GAP = 48;

function imageMetadata(image: Awaited<ReturnType<typeof uploadImage>>): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

function canvasCenterFromViewport(viewport: ViewportTransform) {
    const scale = Math.max(viewport.k, 0.05);
    return {
        x: (DEFAULT_VIEWPORT_SIZE.width / 2 - viewport.x) / scale,
        y: (DEFAULT_VIEWPORT_SIZE.height / 2 - viewport.y) / scale,
    };
}

function waitForCanvasStoreHydrated() {
    if (useCanvasStore.getState().hydrated) return Promise.resolve();

    return new Promise<void>((resolve) => {
        const unsubscribe = useCanvasStore.subscribe((state) => {
            if (!state.hydrated) return;
            unsubscribe();
            resolve();
        });
    });
}

export async function appendDirectorDeskCapturesToCanvasProject(canvasId: string, captures: DirectorDeskCaptureImport[]) {
    const normalizedCaptures = captures.filter((capture) => capture.dataUrl.startsWith("data:image/"));
    if (normalizedCaptures.length === 0) return;

    await waitForCanvasStoreHydrated();
    const state = useCanvasStore.getState();
    const targetCanvasId =
        canvasId ||
        [...state.projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]?.id ||
        "";
    const project = targetCanvasId ? state.openProject(targetCanvasId) : null;
    if (!project) return;

    const center = canvasCenterFromViewport(project.viewport);
    const columns = Math.min(3, normalizedCaptures.length);
    const importedNodes = await Promise.all(
        normalizedCaptures.map(async (capture, index): Promise<CanvasNodeData> => {
            const image = await uploadImage(capture.dataUrl);
            const size = fitNodeSize(image.width, image.height);
            const column = index % columns;
            const row = Math.floor(index / columns);
            return {
                id: `image-${Date.now()}-${nanoid(5)}`,
                type: CanvasNodeType.Image,
                title: capture.fileName.replace(/\.[^.]+$/, "") || "导演台截图",
                position: {
                    x: center.x + column * (size.width + CAPTURE_GRID_GAP) - ((columns - 1) * (size.width + CAPTURE_GRID_GAP)) / 2 - size.width / 2,
                    y: center.y + row * (size.height + CAPTURE_GRID_GAP) - size.height / 2,
                },
                width: size.width,
                height: size.height,
                metadata: imageMetadata(image),
            };
        })
    );

    useCanvasStore.getState().updateProject(project.id, {
        nodes: [...project.nodes, ...importedNodes],
    });
}
