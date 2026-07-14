import { useDirectorStore } from "../store/directorStore";

interface HostPanoramaPayload {
  edgeId?: unknown;
  sourceNodeId?: unknown;
  imageUrl?: unknown;
  fileName?: unknown;
}

interface HostSessionPayload {
  instanceId?: unknown;
  theme?: unknown;
}

export interface HostCaptureItemPayload {
  dataUrl?: unknown;
  fileName?: unknown;
}

export interface HostCaptureBatchPayload {
  captures?: HostCaptureItemPayload[];
}

let initialized = false;
export const DIRECTOR_DESK_SESSION_OPENED_EVENT = "storyai:director-desk-session-opened";

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const HOST_ORIGIN_QUERY_KEY = "hostOrigin";

function normalizeOrigin(value: unknown) {
  const text = normalizeString(value);
  if (!text) return null;

  try {
    return new URL(text).origin;
  } catch {
    return null;
  }
}

export function getDirectorDeskHostOrigin() {
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeOrigin(params.get(HOST_ORIGIN_QUERY_KEY)) ?? window.location.origin;
  } catch {
    return window.location.origin;
  }
}

function isAllowedHostEvent(event: MessageEvent) {
  return event.origin === getDirectorDeskHostOrigin();
}

function normalizeTheme(value: unknown): "dark" | "light" | null {
  return value === "light" || value === "dark" ? value : null;
}

function applyDirectorDeskTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function getInitialHostTheme() {
  try {
    return normalizeTheme(new URLSearchParams(window.location.search).get("theme"));
  } catch {
    return null;
  }
}

function importHostPanorama(_payload: HostPanoramaPayload) {
  // 全景图功能已关闭；保留旧消息入口，避免旧宿主发送时抛错。
}

function openHostSession(payload: HostSessionPayload) {
  const instanceId = normalizeString(payload.instanceId);
  const theme = normalizeTheme(payload.theme);
  if (theme) {
    applyDirectorDeskTheme(theme);
  }
  if (instanceId) {
    useDirectorStore.getState().openScopedScene(instanceId);
    window.dispatchEvent(new CustomEvent(DIRECTOR_DESK_SESSION_OPENED_EVENT, { detail: { instanceId } }));
  }
}

export function postDirectorDeskCapturesToHost(
  captures: Array<{
    dataUrl: string;
    fileName?: string;
  }>
) {
  const normalizedCaptures = captures
    .map((capture, index) => {
      const dataUrl = normalizeString(capture.dataUrl);
      if (!dataUrl) {
        return null;
      }

      return {
        dataUrl,
        fileName: normalizeString(capture.fileName) || `director-desk-capture-${index + 1}.png`,
      };
    })
    .filter((capture): capture is { dataUrl: string; fileName: string } => Boolean(capture));

  if (normalizedCaptures.length === 0) {
    return;
  }

  window.parent?.postMessage(
    {
      type: "storyai:director-desk-captures-sent",
      payload: {
        captures: normalizedCaptures,
      },
    },
    getDirectorDeskHostOrigin()
  );
}

function handleHostMessage(event: MessageEvent) {
  if (!isAllowedHostEvent(event)) {
    return;
  }

  if (event.data?.type === "storyai:director-desk-session") {
    openHostSession((event.data.payload || {}) as HostSessionPayload);
    return;
  }

  if (event.data?.type === "storyai:director-desk-panorama") {
    importHostPanorama((event.data.payload || {}) as HostPanoramaPayload);
  }
}

export function initDirectorDeskHostBridge() {
  if (initialized) {
    return;
  }

  initialized = true;
  applyDirectorDeskTheme(getInitialHostTheme() ?? "dark");
  window.addEventListener("message", handleHostMessage);
}

export function clearDirectorDeskHostBridge() {
  if (!initialized) {
    return;
  }

  initialized = false;
  window.removeEventListener("message", handleHostMessage);
}
