const LAST_DIRECTOR_DESK_CANVAS_ID_KEY = "infinite-canvas:last-director-desk-canvas-id";

export function setLastDirectorDeskCanvasId(canvasId: string) {
    if (!canvasId || typeof window === "undefined") return;
    localStorage.setItem(LAST_DIRECTOR_DESK_CANVAS_ID_KEY, canvasId);
}

export function getLastDirectorDeskCanvasId() {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(LAST_DIRECTOR_DESK_CANVAS_ID_KEY) || "";
}

export function resolveDirectorDeskReturnPath(returnTo: string | null, canvasId: string | null) {
    if (returnTo?.startsWith("/canvas/")) return returnTo;
    const targetCanvasId = canvasId || getLastDirectorDeskCanvasId();
    return targetCanvasId ? `/canvas/${encodeURIComponent(targetCanvasId)}` : "";
}
