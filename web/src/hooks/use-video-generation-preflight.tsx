import { useCallback, useState } from "react";
import { App, Input, Radio, Select } from "antd";

import { inspectVideoGenerationInput, type VideoPreflightInput, type VideoPreflightIssue } from "@/lib/video-generation-preflight";
import { isCangyuanSd5SeedanceModel } from "@/lib/seedance-video";
import { isCangyuanSeedanceFramePair, isOmniImageVideoModel, isOmniVideoToVideoModel, isSoraVideoModel, isVeoVideoModel } from "@/lib/video-model-capabilities";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ApimartAvatarMode, ApimartOmniElement } from "@/types/media";

export type VideoGenerationConfirmation = { apimartAvatarMode?: ApimartAvatarMode; apimartOmniElements?: ApimartOmniElement[] };

export function useVideoGenerationPreflight() {
    const { modal, message } = App.useApp();
    return useCallback(
        async (input: VideoPreflightInput) => {
            const result = await inspectVideoGenerationInput(input);
            if (result.status === "blocked") {
                modal.warning({ title: "无法提交视频任务", content: <IssueList issues={result.issues} />, okText: "返回调整", width: 520 });
                return false;
            }
            if (result.status === "passed") {
                let apimartAvatarMode: ApimartAvatarMode = "ordinary";
                let apimartOmniElements: ApimartOmniElement[] = input.apimartOmniElements || [];
                return new Promise<false | VideoGenerationConfirmation>((resolve) => {
                    modal.confirm({
                        title: "确认视频参考素材",
                        content: <><ReferenceSummary input={input} /><ApimartSeedanceReferenceNotice input={input} /><ApimartAvatarModeChoice input={input} onChange={(value) => { apimartAvatarMode = value; }} /><ApimartOmniElementEditor input={input} onChange={(value) => { apimartOmniElements = value; }} /></>,
                        okText: "确认生成",
                        cancelText: "返回调整",
                        width: 680,
                        onOk: () => {
                            const error = validateApimartOmniElements(input, apimartOmniElements);
                            if (error) {
                                message.error(error);
                                return Promise.reject(new Error(error));
                            }
                            resolve({ apimartAvatarMode: showsApimartAvatarModeChoice(input) ? apimartAvatarMode : undefined, apimartOmniElements: showsApimartOmniElementEditor(input) ? apimartOmniElements : undefined });
                        },
                        onCancel: () => resolve(false),
                    });
                });
            }
            let apimartAvatarMode: ApimartAvatarMode = "ordinary";
            let apimartOmniElements: ApimartOmniElement[] = input.apimartOmniElements || [];
            return new Promise<false | VideoGenerationConfirmation>((resolve) => {
                modal.confirm({
                    title: "生成前发现风险",
                    content: <><ReferenceSummary input={input} /><ApimartSeedanceReferenceNotice input={input} /><ApimartAvatarModeChoice input={input} onChange={(value) => { apimartAvatarMode = value; }} /><ApimartOmniElementEditor input={input} onChange={(value) => { apimartOmniElements = value; }} /><IssueList issues={result.issues} /></>,
                    okText: "仍然生成",
                    cancelText: "返回调整",
                    width: 680,
                    onOk: () => {
                        const error = validateApimartOmniElements(input, apimartOmniElements);
                        if (error) {
                            message.error(error);
                            return Promise.reject(new Error(error));
                        }
                        resolve({ apimartAvatarMode: showsApimartAvatarModeChoice(input) ? apimartAvatarMode : undefined, apimartOmniElements: showsApimartOmniElementEditor(input) ? apimartOmniElements : undefined });
                    },
                    onCancel: () => resolve(false),
                });
            });
        },
        [message, modal],
    );
}

function showsApimartOmniElementEditor(input: VideoPreflightInput) {
    const model = modelOptionName(input.config.model || input.config.videoModel).toLowerCase();
    return resolveModelRequestConfig(input.config, input.config.model || input.config.videoModel).apiFormat === "apimart"
        && model === "kling-v3-omni";
}

function ApimartOmniElementEditor({ input, onChange }: { input: VideoPreflightInput; onChange: (value: ApimartOmniElement[]) => void }) {
    const initialSubjects = [
        { name: "新人物甲", description: "替换参考视频中指定的原人物 A" },
        { name: "新人物乙", description: "替换参考视频中指定的原人物 B" },
        { name: "新人物丙", description: "替换参考视频中指定的原人物 C" },
    ].map((fallback, index) => input.apimartOmniElements?.[index] ? { name: input.apimartOmniElements[index].name, description: input.apimartOmniElements[index].description } : fallback);
    const [assignments, setAssignments] = useState<Record<string, number>>(() => Object.fromEntries((input.apimartOmniElements || []).flatMap((element, index) => element.referenceIds.map((id) => [id, index + 1]))));
    const [subjects, setSubjects] = useState(initialSubjects);
    if (!showsApimartOmniElementEditor(input)) return null;
    const emit = (nextAssignments: Record<string, number>, nextSubjects = subjects) => {
        onChange(nextSubjects.flatMap((subject, index) => {
            const referenceIds = input.references.filter((reference) => nextAssignments[reference.id] === index + 1).map((reference) => reference.id);
            return referenceIds.length ? [{ ...subject, referenceIds }] : [];
        }));
    };
    return (
        <div className="mb-3 rounded-lg border border-violet-500/25 bg-violet-500/[0.06] px-3 py-2.5 text-sm">
            <div className="font-medium">多角色一对一替换</div>
            <div className="mt-1 text-xs opacity-70">把每张沿入线图片明确分配给一个新人物。每个人物 2–4 张，第一张应为清晰正面；提示词用 @新人物甲 等名称说明替换原视频中的谁。</div>
            <div className="mt-3 space-y-2">
                {input.references.map((reference, index) => (
                    <div key={reference.id} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-2">
                        <div className="truncate text-xs">{index + 1}. {reference.name || `参考图 ${index + 1}`}</div>
                        <Select
                            size="small"
                            value={assignments[reference.id]}
                            placeholder="选择所属人物"
                            options={subjects.map((subject, subjectIndex) => ({ value: subjectIndex + 1, label: subject.name }))}
                            onChange={(value) => {
                                const next = { ...assignments, [reference.id]: value };
                                setAssignments(next);
                                emit(next);
                            }}
                        />
                    </div>
                ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
                {subjects.map((subject, index) => (
                    <div key={index} className="space-y-1.5">
                        <Input
                            size="small"
                            value={subject.name}
                            placeholder={`主体 ${index + 1} 名称`}
                            onChange={(event) => {
                                const next = subjects.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item);
                                setSubjects(next);
                                emit(assignments, next);
                            }}
                        />
                        <Input.TextArea
                            size="small"
                            autoSize={{ minRows: 2, maxRows: 3 }}
                            value={subject.description}
                            placeholder="说明替换原视频中的谁"
                            onChange={(event) => {
                                const next = subjects.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item);
                                setSubjects(next);
                                emit(assignments, next);
                            }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

function validateApimartOmniElements(input: VideoPreflightInput, elements: ApimartOmniElement[]) {
    if (!showsApimartOmniElementEditor(input)) return "";
    if (!elements.length || elements.length > 3) return "请配置 1–3 个替换人物";
    const ids = elements.flatMap((element) => element.referenceIds);
    const currentIds = new Set(input.references.map((reference) => reference.id));
    if (ids.length !== input.references.length || new Set(ids).size !== input.references.length || ids.some((id) => !currentIds.has(id))) return "每张当前人物图都必须且只能分配给一个人物";
    const invalid = elements.find((element) => !element.name.trim() || !element.description.trim() || element.referenceIds.length < 2 || element.referenceIds.length > 4);
    if (invalid) return `${invalid.name || "未命名人物"} 必须填写名称、分配 2–4 张图片，并说明替换原视频中的谁`;
    if (new Set(elements.map((element) => element.name.trim())).size !== elements.length) return "不同人物不能使用相同名称";
    return "";
}

function showsApimartAvatarModeChoice(input: VideoPreflightInput) {
    const model = modelOptionName(input.config.model || input.config.videoModel).toLowerCase();
    const requestConfig = resolveModelRequestConfig(input.config, input.config.model || input.config.videoModel);
    return requestConfig.apiFormat === "apimart"
        && (model === "doubao-seedance-2.0" || model === "doubao-seedance-2.0-fast")
        && input.references.length > 0
        && input.videoReferences.length > 0;
}

function isApimartSeedanceModel(input: VideoPreflightInput) {
    const model = modelOptionName(input.config.model || input.config.videoModel).toLowerCase();
    const requestConfig = resolveModelRequestConfig(input.config, input.config.model || input.config.videoModel);
    return requestConfig.apiFormat === "apimart"
        && (model === "doubao-seedance-2.0" || model === "doubao-seedance-2.0-fast" || model === "doubao-seedance-2.0-mini");
}

function ApimartSeedanceReferenceNotice({ input }: { input: VideoPreflightInput }) {
    if (!isApimartSeedanceModel(input) || (!input.references.length && !input.videoReferences.length)) return null;
    return (
        <div className="mb-3 rounded-lg border border-blue-500/25 bg-blue-500/[0.06] px-3 py-2.5 text-sm">
            {input.references.length ? <div>真人参考图片可作为普通参考直接提交，不需要先做人像审核；多张图片会按当前顺序完整写入 <code>image_urls</code>。</div> : null}
            {input.videoReferences.length ? <div className={input.references.length ? "mt-1 text-amber-700 dark:text-amber-300" : "text-amber-700 dark:text-amber-300"}>当前接入文档仍注明“参考视频不可出现真人”。系统不会做人脸检测或硬阻断，请确认参考视频符合渠道规则后再生成；参考视频会完整写入 <code>video_urls</code>。</div> : null}
        </div>
    );
}

function ApimartAvatarModeChoice({ input, onChange }: { input: VideoPreflightInput; onChange: (value: ApimartAvatarMode) => void }) {
    if (!showsApimartAvatarModeChoice(input)) return null;
    return (
        <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-sm">
            <div className="font-medium">人物图片处理方式</div>
            <Radio.Group className="mt-2 flex flex-col gap-2" defaultValue="ordinary" onChange={(event) => onChange(event.target.value)}>
                <Radio value="ordinary">
                    <span className="font-medium">普通参考（默认）</span>
                    <span className="ml-2 text-xs opacity-65">真人图片可直接提交，不经过人像审核</span>
                </Radio>
                <Radio value="identity-lock">
                    <span className="font-medium">身份锁定（可选）</span>
                    <span className="ml-2 text-xs opacity-65">仅在需要身份资产时主动选择，并先提交 APIMart 人像审核</span>
                </Radio>
            </Radio.Group>
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">身份锁定会把人物图片上传至 APIMart 审核；审核未通过时不会创建正式视频任务。</div>
        </div>
    );
}

function ReferenceSummary({ input }: { input: VideoPreflightInput }) {
    const model = modelOptionName(input.config.model || input.config.videoModel) || "未选择模型";
    const fields = actualReferenceFields(input.config, model, input);
    const hasReferences = input.references.length || input.videoReferences.length || input.audioReferences.length;
    return (
        <div className="mb-3 rounded-lg border border-blue-500/25 bg-blue-500/[0.06] px-3 py-2.5 text-sm leading-5">
            <div className="font-medium">本次实际提交</div>
            <div className="mt-1 text-xs opacity-75">请求模型：{model}</div>
            {hasReferences ? (
                <>
                    <div className="mt-1 text-xs">图片 {input.references.length} 张 · 视频 {input.videoReferences.length} 条 · 音频 {input.audioReferences.length} 条</div>
                    <div className="mt-1 text-xs opacity-75">参考字段：{fields.join("、")}</div>
                    <div className="mt-1 text-xs opacity-75">素材会按数组顺序绑定；提示词中的 @ 只负责说明对应关系。</div>
                </>
            ) : (
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">未检测到连接或选择的参考素材，本次将按纯文生视频提交。</div>
            )}
        </div>
    );
}

function actualReferenceFields(config: AiConfig, model: string, input: VideoPreflightInput) {
    const normalized = model.toLowerCase();
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    const isCangyuan = requestConfig.apiFormat === "cangyuan" || requestConfig.baseUrl.toLowerCase().includes("ai.cangyuansuanli.cn");
    if (requestConfig.apiFormat === "apimart" && normalized === "kling-v3-omni") return ["element_list", input.videoReferences.length ? "video_list（base）" : ""].filter(Boolean);
    if (requestConfig.apiFormat === "apimart") return [input.references.length ? "image_urls" : "", input.videoReferences.length ? "video_urls" : "", input.audioReferences.length ? "audio_urls" : ""].filter(Boolean);
    if (isCangyuanSd5SeedanceModel(model)) {
        const framePair = isCangyuanSeedanceFramePair(input.references, input.videoReferences.length, input.audioReferences.length);
        return [framePair ? "reference_mode=frame" : input.references.length || input.videoReferences.length || input.audioReferences.length ? "reference_mode=media" : "", framePair ? "first_image_url" : "", framePair ? "last_image_url" : "", !framePair && input.references.length ? "reference_image_urls" : "", input.videoReferences.length ? "reference_videos" : "", input.audioReferences.length ? "reference_audios" : ""].filter(Boolean);
    }
    if (isOmniImageVideoModel(model)) return input.references.length ? [input.references.length === 1 ? "image_url" : "input_reference（multipart）"] : [];
    if (isOmniVideoToVideoModel(model)) return input.videoReferences.length ? [/^https?:\/\//i.test(input.videoReferences[0].url) ? "video_url" : "input_video（multipart）"] : [];
    if (isSoraVideoModel(model) || isVeoVideoModel(model)) return input.references.length ? ["images"] : [];
    if (normalized.startsWith("grok-video")) return [input.references.length ? "image_urls" : "", input.videoReferences.length ? "video_url" : ""].filter(Boolean);
    if (isCangyuan) {
        const framePair = isCangyuanSeedanceFramePair(input.references, input.videoReferences.length, input.audioReferences.length);
        return [framePair ? "first_image_url" : "", framePair ? "last_image_url" : "", !framePair && input.references.length ? "reference_image_urls" : "", input.videoReferences.length ? "reference_videos" : "", input.audioReferences.length ? "reference_audios" : ""].filter(Boolean);
    }
    if (requestConfig.apiFormat === "ark") return ["content（文本 + 多模态素材）"];
    return input.references.length ? ["input_reference[]"] : [];
}

function IssueList({ issues }: { issues: VideoPreflightIssue[] }) {
    const visible = issues.slice(0, 6);
    return (
        <div className="mt-3 space-y-2">
            {visible.map((issue) => (
                <div key={issue.code} className="rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-sm leading-5 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="font-medium">{issue.message}</div>
                    <div className="mt-0.5 text-xs opacity-65">{issue.suggestion}</div>
                </div>
            ))}
            {issues.length > visible.length ? <div className="text-xs opacity-55">另有 {issues.length - visible.length} 项，请先处理主要问题。</div> : null}
        </div>
    );
}
