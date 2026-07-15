import { javascript } from "@codemirror/lang-javascript";
import CodeMirror from "@uiw/react-codemirror";
import { Alert, Button, Modal, theme as antdTheme } from "antd";
import { useEffect, useState } from "react";

import { MODEL_SCRIPT_RETURNS, MODEL_SCRIPT_TEMPLATES, MODEL_SCRIPT_VARIABLES } from "@/services/api/model-script-runtime";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ModelCapability } from "@/stores/use-config-store";

const capabilityLabels: Record<ModelCapability, string> = { image: "生图", video: "视频", text: "文本", audio: "音频" };

export function ModelScriptEditor({ open, capability, modelName, value, onSave, onClose }: { open: boolean; capability: ModelCapability; modelName: string; value: string; onSave: (script: string) => void; onClose: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const { token } = antdTheme.useToken();
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        if (open) setDraft(value);
    }, [open, value]);

    const variables = MODEL_SCRIPT_VARIABLES.filter((variable) => !variable.capabilities || variable.capabilities.includes(capability));

    return (
        <Modal
            open={open}
            title={
                <div>
                    <div className="text-base font-semibold">{capabilityLabels[capability]}调用脚本{modelName ? ` · ${modelName}` : ""}</div>
                    <div className="mt-1 text-xs font-normal" style={{ color: token.colorTextSecondary }}>
                        脚本是一段异步函数体，最后必须 return 结果；留空继续使用系统原生调用。
                    </div>
                </div>
            }
            width={1080}
            centered
            destroyOnHidden
            onCancel={onClose}
            styles={{ body: { padding: 0 } }}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        {MODEL_SCRIPT_TEMPLATES[capability].map((template) => (
                            <Button key={template.label} size="small" onClick={() => setDraft(template.script)}>
                                插入{template.label}模板
                            </Button>
                        ))}
                        <Button size="small" danger onClick={() => setDraft("")}>
                            恢复原生调用
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={onClose}>取消</Button>
                        <Button
                            type="primary"
                            onClick={() => {
                                onSave(draft.trim());
                                onClose();
                            }}
                        >
                            保存
                        </Button>
                    </div>
                </div>
            }
        >
            <Alert banner showIcon type="warning" message="脚本会在当前浏览器中执行，并可读取该渠道的 API Key、请求网络和处理本地输入；只保存和运行你信任的代码。" />
            <div className="flex h-[60vh] min-h-[420px] border-t" style={{ borderColor: token.colorBorderSecondary }}>
                <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r" style={{ borderColor: token.colorBorderSecondary, background: token.colorFillAlter }}>
                    <div className="border-b px-4 py-3" style={{ borderColor: token.colorBorderSecondary }}>
                        <div className="mb-1.5 text-[11px] font-semibold tracking-wide" style={{ color: token.colorTextTertiary }}>
                            返回要求
                        </div>
                        <div className="text-xs leading-6" style={{ color: token.colorTextSecondary }}>
                            {MODEL_SCRIPT_RETURNS[capability]}
                        </div>
                    </div>
                    <div className="px-4 py-3">
                        <div className="mb-2.5 flex items-center justify-between">
                            <span className="text-[11px] font-semibold tracking-wide" style={{ color: token.colorTextTertiary }}>
                                可用变量
                            </span>
                            <span className="text-[10px]" style={{ color: token.colorTextTertiary }}>
                                点击插入
                            </span>
                        </div>
                        <div className="space-y-1.5">
                            {variables.map((variable) => (
                                <button key={variable.name} type="button" onClick={() => setDraft((current) => (current ? `${current}\n${variable.name}` : variable.name))} className="block w-full rounded-lg border border-transparent px-2.5 py-2 text-left transition hover:opacity-75">
                                    <div className="flex flex-wrap items-baseline gap-1.5">
                                        <code className="rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold" style={{ background: token.colorFillSecondary, color: token.colorText }}>
                                            {variable.name}
                                        </code>
                                        <span className="font-mono text-[10px]" style={{ color: token.colorTextTertiary }}>
                                            {variable.type}
                                        </span>
                                    </div>
                                    <div className="mt-1 text-xs leading-5" style={{ color: token.colorTextSecondary }}>
                                        {variable.desc}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </aside>
                <div className="min-w-0 flex-1 overflow-hidden" style={{ background: token.colorBgContainer }}>
                    <CodeMirror
                        value={draft}
                        onChange={setDraft}
                        height="100%"
                        theme={colorTheme === "dark" ? "dark" : "light"}
                        extensions={[javascript()]}
                        placeholder="// 留空使用系统原生调用；可先插入模板再按平台文档调整。"
                        style={{ height: "100%", fontSize: 13 }}
                        className="h-full [&_.cm-editor]:h-full [&_.cm-gutters]:border-none [&_.cm-scroller]:overflow-auto"
                    />
                </div>
            </div>
        </Modal>
    );
}
