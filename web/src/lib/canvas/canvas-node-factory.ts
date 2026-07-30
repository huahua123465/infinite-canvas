import type { UploadedImage } from "@/services/image-storage";
import type { CanvasNodeMetadata } from "@/types/canvas";

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return {
        content: image.url,
        storageKey: image.storageKey,
        status: "success",
        naturalWidth: image.width,
        naturalHeight: image.height,
        bytes: image.bytes,
        mimeType: image.mimeType,
    };
}
