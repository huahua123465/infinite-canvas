import { useEffect, useMemo, useState } from "react";
import { Button, Input, Modal, Select, Switch } from "antd";
import { Check, Copy, LoaderCircle, RefreshCw, Upload, X } from "lucide-react";

import { useDraggableLayer } from "@/hooks/use-draggable-layer";
import { listVolcengineVoiceClones, requestVolcengineVoiceClone, requestVolcengineVoiceCloneStatus, type VolcengineVoiceCloneRecord } from "@/services/api/audio";
import type { AiConfig } from "@/stores/use-config-store";

const DEFAULT_DEMO_TEXT = "你好，这是我的声音复刻试听。请用自然、清晰、稳定的语气读出这段话。";

const languageOptions = [
    { value: 0, label: "中文" },
    { value: 1, label: "英文" },
    { value: 2, label: "日语" },
    { value: 8, label: "韩语" },
];

export function VolcengineVoiceCloneModal({ open, config, currentSpeaker, onClose, onSelect }: { open: boolean; config: AiConfig; currentSpeaker: string; onClose: () => void; onSelect: (value: string) => void }) {
    const [items, setItems] = useState<VolcengineVoiceCloneRecord[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const [name, setName] = useState("");
    const [customSpeakerId, setCustomSpeakerId] = useState(() => `custom_zh_${Date.now().toString(36)}`);
    const [sampleText, setSampleText] = useState("");
    const [demoText, setDemoText] = useState(DEFAULT_DEMO_TEXT);
    const [language, setLanguage] = useState(0);
    const [enableDenoise, setEnableDenoise] = useState(false);
    const [loading, setLoading] = useState(false);
    const [refreshingId, setRefreshingId] = useState("");
    const [error, setError] = useState("");
    const draggable = useDraggableLayer(open);
    const selected = useMemo(() => items.find((item) => item.speakerId === currentSpeaker), [currentSpeaker, items]);
    useVoiceCloneModalOutsideClose(open, onClose);

    useEffect(() => {
        if (!open) return;
        void reloadItems();
    }, [open]);

    const reloadItems = async () => setItems(await listVolcengineVoiceClones());

    const cloneVoice = async () => {
        if (!file) {
            setError("请先上传一段用于复刻的音频");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const record = await requestVolcengineVoiceClone(config, { file, name, customSpeakerId, text: sampleText, demoText, language, enableAudioDenoise: enableDenoise });
            setItems([record, ...(await listVolcengineVoiceClones()).filter((item) => item.id !== record.id)]);
            onSelect(record.speakerId);
        } catch (err) {
            setError(err instanceof Error ? err.message : "声音复刻失败");
        } finally {
            setLoading(false);
        }
    };

    const refreshVoice = async (record: VolcengineVoiceCloneRecord) => {
        setRefreshingId(record.id);
        setError("");
        try {
            const next = await requestVolcengineVoiceCloneStatus(config, record);
            setItems((prev) => prev.map((item) => (item.id === next.id ? next : item)));
        } catch (err) {
            setError(err instanceof Error ? err.message : "查询复刻状态失败");
        } finally {
            setRefreshingId("");
        }
    };

    const copyId = async (speakerId: string) => {
        await navigator.clipboard?.writeText(speakerId);
    };

    return (
        <Modal
            open={open}
            title={null}
            footer={null}
            centered
            width={780}
            zIndex={1800}
            closeIcon={<X className="size-5" />}
            maskClosable={false}
            onCancel={onClose}
            modalRender={(modal) => <div style={draggable.style}>{modal}</div>}
            styles={{ mask: { background: "rgba(0,0,0,.68)" }, content: { padding: 0, overflow: "hidden", borderRadius: 12, background: "#172325" }, body: { padding: 0 } }}
        >
            <div className={`flex max-h-[82vh] flex-col border border-cyan-500/20 bg-[#172325] text-cyan-50 ${draggable.handleProps.className}`} onPointerDown={draggable.handleProps.onPointerDown} onMouseDown={(event) => event.stopPropagation()}>
                <div {...draggable.handleProps} className={`border-b border-cyan-500/15 px-5 py-4 pr-12 ${draggable.handleProps.className}`}>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Upload className="size-4" />
                        声音复刻
                    </div>
                    <div className="mt-1 text-xs leading-5 text-cyan-100/60">上传自己的声音样本，训练成功后会得到可复制、可选择的 speaker ID。试听满意后再用于正式音频生成。</div>
                    <div className="mt-2 rounded border border-amber-300/25 bg-amber-300/10 px-2.5 py-1.5 text-xs leading-5 text-amber-100">后付费音色在试听阶段不收取音色槽位费；一旦用该音色正式合成，可能触发火山计费。</div>
                </div>

                <div className="thin-scrollbar grid min-h-0 flex-1 gap-4 overflow-auto p-4">
                    <section className="grid gap-3 rounded-lg border border-cyan-500/15 bg-black/20 p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                            <label className="grid gap-1.5 text-xs text-cyan-100/70">
                                音色名称
                                <Input value={name} placeholder="例如：我的旁白音色" onChange={(event) => setName(event.target.value)} />
                            </label>
                            <label className="grid gap-1.5 text-xs text-cyan-100/70">
                                自定义 speaker ID
                                <Input value={customSpeakerId} placeholder="custom_zh_my_voice" onChange={(event) => setCustomSpeakerId(event.target.value)} />
                            </label>
                        </div>
                        <label className="grid gap-1.5 text-xs text-cyan-100/70">
                            上传声音样本
                            <input className="block w-full rounded border border-cyan-500/20 bg-black/20 px-3 py-2 text-sm text-cyan-50 file:mr-3 file:rounded file:border-0 file:bg-cyan-400 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[#102426]" type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.aac,.pcm" onChange={(event) => setFile(event.target.files?.[0] || null)} />
                        </label>
                        {file ? <div className="text-xs text-cyan-100/60">{file.name} · {Math.round(file.size / 1024)} KB</div> : null}
                        <Input.TextArea className="!min-h-16 !resize-none" value={sampleText} onChange={(event) => setSampleText(event.target.value)} placeholder="可选：如果样本是按固定文本朗读，把原文填在这里，火山会校验音频与文本差异。" />
                        <Input.TextArea className="!min-h-16 !resize-none" value={demoText} onChange={(event) => setDemoText(event.target.value)} placeholder="试听文本，4-300字" />
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <Select className="w-28" value={language} options={languageOptions} onChange={setLanguage} getPopupContainer={(triggerNode) => triggerNode.parentElement || document.body} />
                                <span className="flex items-center gap-2 text-xs text-cyan-100/70">
                                    <Switch size="small" checked={enableDenoise} onChange={setEnableDenoise} />
                                    开启降噪
                                </span>
                            </div>
                            <Button type="primary" icon={loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} disabled={loading} onClick={() => void cloneVoice()}>
                                开始复刻
                            </Button>
                        </div>
                        {error ? <div className="rounded border border-red-500/25 bg-red-500/10 px-2 py-1.5 text-xs leading-5 text-red-100">{error}</div> : null}
                    </section>

                    <section className="grid gap-2">
                        <div className="text-xs font-semibold text-cyan-100/70">我的复刻音色</div>
                        {items.length ? (
                            items.map((item) => {
                                const active = item.speakerId === currentSpeaker;
                                const refreshing = refreshingId === item.id;
                                return (
                                    <div key={item.id} className={`rounded-lg border p-3 ${active ? "border-cyan-300/55 bg-cyan-400/10" : "border-cyan-500/15 bg-black/20"}`}>
                                        <div className="flex items-start gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <div className="truncate text-sm font-semibold text-cyan-50">{item.name || item.speakerId}</div>
                                                    <span className="shrink-0 rounded bg-cyan-100/10 px-1.5 py-0.5 text-[10px] text-cyan-100/70">{voiceCloneStatusLabel(item.status)}</span>
                                                    {active ? <span className="shrink-0 rounded bg-cyan-300 px-1.5 py-0.5 text-[10px] font-semibold text-[#112426]">当前选择</span> : null}
                                                </div>
                                                <div className="mt-1 truncate text-xs text-cyan-100/60">{item.speakerId}</div>
                                                {item.demoAudioUrl ? <audio src={item.demoAudioUrl} controls className="mt-3 h-8 w-full" /> : <div className="mt-2 text-xs text-cyan-100/50">训练成功后会显示试听音频。</div>}
                                            </div>
                                            <div className="flex shrink-0 flex-col gap-2">
                                                <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copyId(item.speakerId)}>复制 ID</Button>
                                                <Button size="small" icon={refreshing ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} disabled={refreshing} onClick={() => void refreshVoice(item)}>查询</Button>
                                                <Button size="small" type={active ? "primary" : "default"} icon={<Check className="size-3.5" />} onClick={() => onSelect(item.speakerId)}>设为当前</Button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="rounded-lg border border-cyan-500/15 bg-black/20 px-3 py-5 text-center text-xs text-cyan-100/55">还没有复刻音色</div>
                        )}
                    </section>
                </div>
                {selected ? <div className="border-t border-cyan-500/15 px-4 py-2 text-xs text-cyan-100/55">当前音色：{selected.speakerId}</div> : null}
            </div>
        </Modal>
    );
}

function isVoiceCloneModalInnerTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(".ant-modal, .ant-select-dropdown, .ant-dropdown, .ant-picker-dropdown, .ant-popover"));
}

function useVoiceCloneModalOutsideClose(open: boolean, onClose: () => void) {
    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (!isVoiceCloneModalInnerTarget(event.target)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [open, onClose]);
}

function voiceCloneStatusLabel(status?: number) {
    if (status === 1) return "训练中";
    if (status === 2) return "成功";
    if (status === 3) return "失败";
    if (status === 4) return "可合成";
    if (status === 0) return "未找到";
    return "待查询";
}
