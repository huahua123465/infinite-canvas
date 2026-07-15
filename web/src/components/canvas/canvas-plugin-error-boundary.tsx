import { Component, type ErrorInfo, type ReactNode } from "react";
import { Puzzle } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";

export class CanvasPluginErrorBoundary extends Component<{ children: ReactNode; resetKey: string; theme: CanvasTheme }, { error: Error | null }> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("[plugin] 节点渲染失败", error, info);
    }

    componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
        if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: this.props.theme.node.placeholder }}>
                <Puzzle className="size-7 opacity-40" />
                <span className="text-sm">插件节点运行失败</span>
                <span className="max-w-full truncate text-[11px] opacity-70">{this.state.error.message}</span>
            </div>
        );
    }
}
