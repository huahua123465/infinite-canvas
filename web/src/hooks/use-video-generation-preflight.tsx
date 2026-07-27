import { useCallback } from "react";
import { App } from "antd";

import { inspectVideoGenerationInput, type VideoPreflightInput, type VideoPreflightIssue } from "@/lib/video-generation-preflight";
import { isCangyuanSd5SeedanceModel } from "@/lib/seedance-video";
import { isCangyuanSeedanceFramePair, isOmniImageVideoModel, isOmniVideoToVideoModel, isSoraVideoModel, isVeoVideoModel } from "@/lib/video-model-capabilities";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export function useVideoGenerationPreflight() {
    const { modal } = App.useApp();
    return useCallback(
        async (input: VideoPreflightInput) => {
            const result = await inspectVideoGenerationInput(input);
            if (result.status === "blocked") {
                modal.warning({ title: "无法提交视频任务", content: <IssueList issues={result.issues} />, okText: "返回调整", width: 520 });
                return false;
            }
            if (result.status === "passed") {
                return new Promise<boolean>((resolve) => {
                    modal.confirm({
                        title: "确认视频参考素材",
                        content: <ReferenceSummary input={input} />,
                        okText: "确认生成",
                        cancelText: "返回调整",
                        width: 560,
                        onOk: () => resolve(true),
                        onCancel: () => resolve(false),
                    });
                });
            }
            return new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: "生成前发现风险",
                    content: <><ReferenceSummary input={input} /><IssueList issues={result.issues} /></>,
                    okText: "仍然生成",
                    cancelText: "返回调整",
                    width: 520,
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            });
        },
        [modal],
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
    if (isCangyuanSd5SeedanceModel(model)) return [input.references.length ? "images" : "", input.videoReferences.length ? "reference_videos" : "", input.audioReferences.length ? "reference_audios" : ""].filter(Boolean);
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
