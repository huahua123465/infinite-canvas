import { useCallback, useEffect, useRef, useState } from "react";

import { resolveAudioProvider } from "@/lib/audio-provider";
import { listVoiceboxProfiles, type VoiceboxProfile } from "@/services/api/audio";
import type { AiConfig } from "@/stores/use-config-store";

export function VoiceboxProfileSelect({ config, value, onChange }: { config: AiConfig; value: string; onChange: (value: string) => void }) {
    const [profiles, setProfiles] = useState<VoiceboxProfile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const provider = resolveAudioProvider(config, resolveAudioProvider(config, config.model).kind === "voicebox" ? config.model : config.audioModel);
    const configRef = useRef(config);
    configRef.current = config;
    const sourceKey = `${provider.baseUrl}\n${provider.model}`;

    const loadProfiles = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError("");
        try {
            setProfiles(await listVoiceboxProfiles(configRef.current, signal));
        } catch (reason) {
            if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "读取 Voicebox 声音档案失败");
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void loadProfiles(controller.signal);
        return () => controller.abort();
    }, [loadProfiles, sourceKey]);

    return (
        <div className="space-y-2">
            <select
                className="h-9 w-full rounded-lg border border-current/20 bg-transparent px-3 text-sm outline-none"
                value={profiles.some((profile) => profile.id === value) ? value : ""}
                onChange={(event) => onChange(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <option value="">{loading ? "正在读取 Voicebox 声音档案…" : profiles.length ? "请选择声音档案" : "暂无可用声音档案"}</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.language} · {profile.voice_type === "preset" ? "预设" : "克隆"}</option>)}
            </select>
            <div className="flex items-center justify-between gap-3 text-xs opacity-70">
                <span>{error || `已读取 ${profiles.length} 个声音档案`}</span>
                <span className="flex shrink-0 gap-3">
                    <button type="button" className="hover:opacity-70" onClick={() => void loadProfiles()}>刷新</button>
                    <button type="button" className="hover:opacity-70" onClick={() => window.open(provider.baseUrl.replace(/\/+$/, ""), "_blank", "noopener,noreferrer")}>打开 Voicebox</button>
                </span>
            </div>
        </div>
    );
}
