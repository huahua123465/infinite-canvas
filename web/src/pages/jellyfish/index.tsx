import { ArrowLeft, ExternalLink, Fish, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useConfigStore } from "@/stores/use-config-store";

const JELLYFISH_ORIGIN = "http://localhost:7788";

export default function JellyfishPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const returnPath = searchParams.get("returnTo") || "/canvas";
    const jellyfishUrl = useMemo(() => `${JELLYFISH_ORIGIN}/`, []);
    const config = useConfigStore((state) => state.config);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    function postCanvasConfig(frame: HTMLIFrameElement) {
        frame.contentWindow?.postMessage({
            type: "infinite-canvas:config",
            config: {
                channels: config.channels.map((channel) => ({
                    id: channel.id,
                    name: channel.name,
                    baseUrl: channel.baseUrl,
                    hasApiKey: Boolean(channel.apiKey.trim()),
                    apiFormat: channel.apiFormat,
                    models: channel.models,
                })),
                model: config.model,
                imageModel: config.imageModel,
                videoModel: config.videoModel,
                textModel: config.textModel,
                audioModel: config.audioModel,
                imageModels: config.imageModels,
                videoModels: config.videoModels,
                textModels: config.textModels,
                audioModels: config.audioModels,
            },
        }, JELLYFISH_ORIGIN);
    }

    useEffect(() => {
        if (iframeRef.current) postCanvasConfig(iframeRef.current);
    }, [config]);

    return (
        <main className="flex h-dvh min-h-0 w-full flex-col bg-stone-100 dark:bg-stone-950">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-stone-200 bg-background/90 px-4 dark:border-stone-800">
                <div className="flex min-w-0 items-center gap-2">
                    <Fish className="size-4 text-cyan-600" />
                    <span className="truncate text-sm font-medium">Jellyfish AI 短剧工作台</span>
                    <span className="hidden text-xs text-muted-foreground md:inline">已嵌入当前画布</span>
                </div>
                <div className="flex items-center gap-1">
                    <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-400/70 bg-cyan-50 px-3 text-xs font-medium text-cyan-700 shadow-sm transition hover:border-cyan-500 hover:bg-cyan-100 dark:border-cyan-500/60 dark:bg-cyan-950/40 dark:text-cyan-200 dark:hover:bg-cyan-950/70" onClick={() => navigate(returnPath)} aria-label="返回当前画布" title="返回当前画布">
                        <ArrowLeft className="size-4" />
                        <span>返回当前画布</span>
                    </button>
                    <button type="button" className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-stone-200 hover:text-foreground dark:hover:bg-stone-800" onClick={() => window.open(jellyfishUrl, "_blank", "noopener,noreferrer")} aria-label="在新窗口打开 Jellyfish" title="在新窗口打开 Jellyfish">
                        <ExternalLink className="size-4" />
                    </button>
                    <button type="button" className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-stone-200 hover:text-foreground dark:hover:bg-stone-800" onClick={() => window.location.reload()} aria-label="刷新 Jellyfish" title="刷新 Jellyfish">
                        <RefreshCw className="size-4" />
                    </button>
                </div>
            </div>
            <iframe ref={iframeRef} title="Jellyfish AI 短剧工作台" src={jellyfishUrl} onLoad={(event) => postCanvasConfig(event.currentTarget)} className="h-full min-h-0 w-full flex-1 border-0 bg-white" />
        </main>
    );
}
