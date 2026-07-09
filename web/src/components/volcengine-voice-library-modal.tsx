import { useMemo, useState } from "react";
import { Button, Input, Modal } from "antd";
import { Check, LoaderCircle, Volume2, X } from "lucide-react";

import { volcengineVoiceOptions } from "@/lib/audio-generation";
import { requestStoredAudioGeneration } from "@/services/api/audio";
import type { AiConfig } from "@/stores/use-config-store";

const VOICE_LIBRARY_SAMPLE_TEXT = "你好，我是这个声音。我们先听听这段配音是否适合当前角色。";

export function VolcengineVoiceLibraryModal({ open, config, modelValue, currentSpeaker, roleName, onClose, onSelect }: { open: boolean; config: AiConfig; modelValue?: string; currentSpeaker: string; roleName?: string; onClose: () => void; onSelect: (value: string) => void }) {
    const [keyword, setKeyword] = useState("");
    const [sampleText, setSampleText] = useState(VOICE_LIBRARY_SAMPLE_TEXT);
    const [previewing, setPreviewing] = useState("");
    const [previews, setPreviews] = useState<Record<string, { url: string; cacheHit?: "local" | "shared" }>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const filteredVoices = useMemo(() => {
        const source = keyword.trim().toLowerCase();
        if (!source) return volcengineVoiceOptions;
        return volcengineVoiceOptions.filter((voice) => [voice.label, voice.value, voice.tone, voice.gender, voice.age, ...voice.tags].join(" ").toLowerCase().includes(source));
    }, [keyword]);
    const previewVoice = async (voice: (typeof volcengineVoiceOptions)[number]) => {
        const text = sampleText.trim();
        if (!text) {
            setErrors((prev) => ({ ...prev, [voice.value]: "请先填写试听文案" }));
            return;
        }
        const key = voicePreviewKey(voice.value, text);
        if (previews[key]?.url) return;
        setPreviewing(voice.value);
        setErrors((prev) => ({ ...prev, [voice.value]: "" }));
        try {
            const audio = await requestStoredAudioGeneration(
                {
                    ...config,
                    model: modelValue || config.audioModel || config.model,
                    audioVoice: voice.value,
                    audioInstructions: [config.audioInstructions, "只朗读输入文本，不要读出说明、标题或括号。保持自然中文口语。"].filter(Boolean).join("\n"),
                },
                text,
            );
            setPreviews((prev) => ({ ...prev, [key]: { url: audio.url, cacheHit: audio.cacheHit } }));
        } catch (error) {
            setErrors((prev) => ({ ...prev, [voice.value]: error instanceof Error ? error.message : "试听生成失败" }));
        } finally {
            setPreviewing("");
        }
    };
    const selectVoice = (value: string) => {
        onSelect(value);
        onClose();
    };
    return (
        <Modal
            open={open}
            title={null}
            footer={null}
            centered
            width={760}
            closeIcon={<X className="size-5" />}
            onCancel={onClose}
            styles={{ mask: { background: "rgba(0,0,0,.68)" }, content: { padding: 0, overflow: "hidden", borderRadius: 12, background: "#172325" }, body: { padding: 0 } }}
        >
            <div className="flex max-h-[82vh] flex-col border border-cyan-500/20 bg-[#172325] text-cyan-50">
                <div className="border-b border-cyan-500/15 px-5 py-4 pr-12">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Volume2 className="size-4" />
                        火山音色试听库
                    </div>
                    <div className="mt-1 text-xs leading-5 text-cyan-100/60">先逐个试听音色效果，再把喜欢的 Voice_type 选择给{roleName ? `“${roleName}”` : "当前音频"}。</div>
                    <div className="mt-2 rounded border border-amber-300/25 bg-amber-300/10 px-2.5 py-1.5 text-xs leading-5 text-amber-100">首次生成试听会调用当前语音 API，可能消耗额度；生成成功后会缓存，重复播放不再请求。</div>
                </div>
                <div className="grid gap-3 border-b border-cyan-500/15 p-4">
                    <Input.Search value={keyword} placeholder="搜索音色名、Voice_type 或标签" allowClear onChange={(event) => setKeyword(event.target.value)} />
                    <Input.TextArea className="!min-h-16 !resize-none" value={sampleText} onChange={(event) => setSampleText(event.target.value)} placeholder="试听文案" />
                </div>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-auto p-3">
                    <div className="grid gap-2">
                        {filteredVoices.map((voice) => {
                            const preview = previews[voicePreviewKey(voice.value, sampleText.trim())];
                            const active = currentSpeaker === voice.value;
                            const loading = previewing === voice.value;
                            return (
                                <div key={voice.value} className={`rounded-lg border p-3 ${active ? "border-cyan-300/55 bg-cyan-400/10" : "border-cyan-500/15 bg-black/20"}`}>
                                    <div className="flex items-start gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <div className="truncate text-sm font-semibold text-cyan-50">{voice.label}</div>
                                                {active ? <span className="shrink-0 rounded bg-cyan-300 px-1.5 py-0.5 text-[10px] font-semibold text-[#112426]">当前选择</span> : null}
                                            </div>
                                            <div className="mt-1 truncate text-xs text-cyan-100/60">{voice.value}</div>
                                            <div className="mt-1 text-xs leading-5 text-cyan-100/75">{voice.tone}</div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {[voice.gender === "female" ? "女声" : "男声", voice.age === "young" ? "年轻" : voice.age === "old" ? "年长" : "成年", ...voice.tags].slice(0, 6).map((tag) => (
                                                    <span key={tag} className="rounded bg-cyan-100/10 px-1.5 py-0.5 text-[10px] text-cyan-100/70">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <Button size="small" icon={loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Volume2 className="size-3.5" />} disabled={loading} onClick={() => void previewVoice(voice)}>
                                                生成试听
                                            </Button>
                                            <Button size="small" type={active ? "primary" : "default"} icon={<Check className="size-3.5" />} onClick={() => selectVoice(voice.value)}>
                                                选择
                                            </Button>
                                        </div>
                                    </div>
                                    {preview?.url ? (
                                        <div className="mt-3">
                                            <audio src={preview.url} controls className="h-8 w-full" />
                                            <div className="mt-1 text-[11px] text-cyan-100/55">{preview.cacheHit === "shared" ? "来自仓库共享缓存" : preview.cacheHit === "local" ? "来自本地缓存" : "已生成并写入本地缓存"}</div>
                                        </div>
                                    ) : null}
                                    {errors[voice.value] ? <div className="mt-2 rounded border border-red-500/25 bg-red-500/10 px-2 py-1.5 text-xs leading-5 text-red-100">{errors[voice.value]}</div> : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function voicePreviewKey(voice: string, text: string) {
    return `${voice}::${text.trim()}`;
}
