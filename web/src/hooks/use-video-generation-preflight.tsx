import { useCallback } from "react";
import { App } from "antd";

import { inspectVideoGenerationInput, type VideoPreflightInput, type VideoPreflightIssue } from "@/lib/video-generation-preflight";

export function useVideoGenerationPreflight() {
    const { modal } = App.useApp();
    return useCallback(
        async (input: VideoPreflightInput) => {
            const result = await inspectVideoGenerationInput(input);
            if (result.status === "passed") return true;
            if (result.status === "blocked") {
                modal.warning({ title: "无法提交视频任务", content: <IssueList issues={result.issues} />, okText: "返回调整", width: 520 });
                return false;
            }
            return new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: "生成前发现风险",
                    content: <IssueList issues={result.issues} />,
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
