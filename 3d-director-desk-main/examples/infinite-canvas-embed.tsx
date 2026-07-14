import { useEffect, useRef } from "react";

export function DirectorDeskFrame({
  directorOrigin = "http://localhost:5173",
  instanceId,
  theme = "dark",
}: {
  directorOrigin?: string;
  instanceId: string;
  theme?: "dark" | "light";
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hostOrigin = window.location.origin;
  const src = `${directorOrigin}/?instanceId=${encodeURIComponent(instanceId)}&theme=${theme}&hostOrigin=${encodeURIComponent(hostOrigin)}`;

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== directorOrigin) return;

      if (event.data?.type === "storyai:director-desk-ready") {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "storyai:director-desk-session",
            payload: { instanceId, theme },
          },
          directorOrigin
        );
      }

      if (event.data?.type === "storyai:director-desk-captures-sent") {
        const captures = event.data.payload?.captures ?? [];
        // TODO: 在无限画布里把 captures[].dataUrl 保存为文件，再创建图片节点。
        console.log("director captures", captures);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [directorOrigin, instanceId, theme]);

  return <iframe ref={iframeRef} src={src} style={{ width: "100%", height: "100%", border: 0 }} />;
}
