import { useEffect, useMemo, useState } from "react";
import { App, Button, Input, Modal, Tag } from "antd";
import { FilePlus2, WandSparkles } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { type AiConfig } from "@/stores/use-config-store";
import { PROMPT_ASSISTANT_PRESETS, applyPromptPreset, appendPrompt, type PromptAssistantPresetId } from "@/lib/canvas/prompt-assistant";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const { TextArea } = Input;

type CanvasPromptAssistantDialogProps = {
    node: CanvasNodeData | null;
    open: boolean;
    loading?: boolean;
    config: AiConfig;
    selectedModel: string;
    onClose: () => void;
    onModelChange: (model: string) => void;
    onMissingConfig: () => void;
    onApply: (node: CanvasNodeData, prompt: string, mode: "replace" | "append" | "text") => void;
    onAiRewrite: (node: CanvasNodeData, prompt: string, requirement: string, model: string) => Promise<string>;
};

export function CanvasPromptAssistantDialog({ node, open, loading = false, config, selectedModel, onClose, onModelChange, onMissingConfig, onApply, onAiRewrite }: CanvasPromptAssistantDialogProps) {
    const { message } = App.useApp();
    const sourcePrompt = useMemo(() => readNodePrompt(node), [node]);
    const [draftPrompt, setDraftPrompt] = useState("");
    const [requirement, setRequirement] = useState("保留人物脸型、五官和气质，换成现代穿搭，发型也现代化，9:16竖屏。");
    const [aiLoading, setAiLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setDraftPrompt(sourcePrompt);
        setRequirement("保留人物脸型、五官和气质，换成现代穿搭，发型也现代化，9:16竖屏。");
    }, [open, sourcePrompt]);

    if (!node) return null;

    const applyPreset = (presetId: PromptAssistantPresetId) => {
        setDraftPrompt((current) => applyPromptPreset(current || sourcePrompt, presetId));
    };

    const rewriteWithAi = async () => {
        try {
            setAiLoading(true);
            const result = await onAiRewrite(node, draftPrompt || sourcePrompt, requirement, selectedModel);
            setDraftPrompt(result);
            message.success("AI 已优化提示词");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "AI 优化失败");
        } finally {
            setAiLoading(false);
        }
    };

    const canApply = Boolean(draftPrompt.trim()) && !loading && !aiLoading;
    const nodeTypeLabel = node.type === CanvasNodeType.Config ? "生成配置" : node.type === CanvasNodeType.Image ? "图片节点" : node.type === CanvasNodeType.Script ? "脚本节点" : node.type === CanvasNodeType.Text ? "文本节点" : "节点";

    return (
        <Modal
            title="AI改提示词"
            open={open}
            centered
            width={860}
            onCancel={onClose}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    关闭
                </Button>,
                <Button key="text" icon={<FilePlus2 className="size-4" />} disabled={!canApply} onClick={() => onApply(node, draftPrompt, "text")}>
                    新建文本节点
                </Button>,
                <Button key="append" disabled={!canApply} onClick={() => onApply(node, draftPrompt, "append")}>
                    追加到当前提示词
                </Button>,
                <Button key="replace" type="primary" disabled={!canApply} onClick={() => onApply(node, draftPrompt, "replace")}>
                    替换当前提示词
                </Button>,
            ]}
        >
            <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <Tag color="blue">{nodeTypeLabel}</Tag>
                    <span className="truncate">目标：{node.title || node.id}</span>
                </div>

                <section>
                    <div className="mb-2 text-sm font-medium">快捷模板</div>
                    <div className="flex flex-wrap gap-2">
                        {PROMPT_ASSISTANT_PRESETS.map((preset) => (
                            <Button key={preset.id} size="small" onClick={() => applyPreset(preset.id)} title={preset.description}>
                                {preset.label}
                            </Button>
                        ))}
                    </div>
                </section>

                <section>
                    <div className="mb-2 text-sm font-medium">自定义修改要求</div>
                    <TextArea value={requirement} onChange={(event) => setRequirement(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="例如：保留脸型五官，换现代穿搭，发型改成自然披发，不要古装。" />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <ModelPicker config={config} value={selectedModel} onChange={onModelChange} capability="text" placeholder="选择文本模型" onMissingConfig={onMissingConfig} />
                        <Button type="default" icon={<WandSparkles className="size-4" />} loading={aiLoading} onClick={rewriteWithAi}>
                            AI智能优化
                        </Button>
                    </div>
                    <div className="mt-1 text-xs text-stone-500">需要先在右上角配置里设置文本模型和 API Key；快捷模板不需要模型。</div>
                </section>

                <section>
                    <div className="mb-2 text-sm font-medium">结果预览</div>
                    <TextArea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} autoSize={{ minRows: 10, maxRows: 18 }} placeholder="这里会显示修改后的提示词" />
                </section>
            </div>
        </Modal>
    );
}

export function readNodePrompt(node: CanvasNodeData | null) {
    if (!node) return "";
    return node.metadata?.composerContent || node.metadata?.prompt || (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script ? node.metadata?.content : "") || "";
}

export function promptPatchForNode(node: CanvasNodeData, prompt: string) {
    if (node.type === CanvasNodeType.Config) return { composerContent: prompt, prompt };
    if (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script) return { content: prompt, prompt };
    return { prompt, sourcePrompt: node.metadata?.sourcePrompt || prompt };
}

export function mergePromptForNode(node: CanvasNodeData, prompt: string, mode: "replace" | "append") {
    const current = readNodePrompt(node);
    return mode === "append" ? appendPrompt(current, prompt) : prompt;
}
