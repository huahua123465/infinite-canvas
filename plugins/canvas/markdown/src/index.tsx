// Markdown 节点:编辑 Markdown,经 marked 解析和 DOMPurify 净化后渲染。
// styles.css 由 esbuild 以 text 方式打进 bundle,通过 plugin.css 自动注入。
import DOMPurify from "dompurify";
import { marked } from "marked";

import { definePlugin, useMemo, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

import css from "./styles.css";

function MarkdownContent({ ctx }: CanvasNodeContentProps) {
    const [editing, setEditing] = useState(false);
    const value = ctx.node.metadata?.content || "";
    const html = useMemo(() => DOMPurify.sanitize(marked.parse(value || "*双击正文或点击右上角按钮编辑 Markdown*") as string, { USE_PROFILES: { html: true } }), [value]);

    const toggle = { position: "absolute", right: 8, top: 8, zIndex: 20, width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, border: `1px solid ${ctx.theme.node.stroke}`, background: `${ctx.theme.toolbar.panel}dd`, color: ctx.theme.node.text, cursor: "pointer" } as const;

    return (
        <div data-canvas-no-zoom style={{ position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
            <button data-canvas-no-drag type="button" style={toggle} onMouseDown={(event) => event.stopPropagation()} onClick={() => setEditing((v) => !v)} title={editing ? "预览" : "编辑"}>
                {editing ? "👁" : "✎"}
            </button>
            {editing ? (
                <textarea data-canvas-no-drag autoFocus value={value} placeholder="# 输入 Markdown" onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(e) => ctx.updateMetadata({ content: e.target.value })} onWheel={(e) => e.stopPropagation()} style={{ height: "100%", width: "100%", resize: "none", background: "transparent", padding: 16, fontFamily: "monospace", fontSize: 14, outline: "none", border: "none", color: ctx.theme.node.text }} />
            ) : (
                <div className="cnv-md" onWheel={(e) => e.stopPropagation()} style={{ color: ctx.theme.node.text }} dangerouslySetInnerHTML={{ __html: html }} />
            )}
        </div>
    );
}

export default definePlugin({
    id: "markdown",
    name: "Markdown 节点",
    version: "1.0.0",
    description: "在画布中编辑与渲染 Markdown",
    css,
    nodes: [
        {
            type: "markdown:doc",
            title: "Markdown",
            icon: "📝",
            description: "编辑与渲染 Markdown",
            defaultSize: { width: 360, height: 300 },
            defaultMetadata: { content: "" },
            minimapColor: "#6366f1",
            resource: (node) => ({ kind: "text", text: node.metadata?.content }),
            Content: MarkdownContent,
        },
    ],
});
