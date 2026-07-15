import DOMPurify from "./vendor/purify-3.4.12.es.mjs";
import { marked } from "./vendor/marked-17.0.6.esm.js";

const css = `.cnv-md{height:100%;width:100%;overflow:auto;padding:16px;font-size:14px;line-height:1.6}.cnv-md h1,.cnv-md h2,.cnv-md h3{margin:.6em 0 .3em;font-weight:600;line-height:1.3}.cnv-md h1{font-size:1.5em}.cnv-md h2{font-size:1.3em}.cnv-md p{margin:.5em 0}.cnv-md a{color:#6366f1;text-decoration:underline}.cnv-md code{padding:.1em .35em;border-radius:4px;background:rgba(120,120,120,.16);font-family:monospace;font-size:.9em}.cnv-md pre{padding:12px;border-radius:8px;background:rgba(120,120,120,.14);overflow:auto}.cnv-md pre code{padding:0;background:transparent}.cnv-md ul,.cnv-md ol{padding-left:1.4em;margin:.5em 0}.cnv-md blockquote{margin:.5em 0;padding-left:.8em;border-left:3px solid rgba(120,120,120,.4);opacity:.85}.cnv-md img{max-width:100%}`;

export default function createMarkdownPlugin(runtime) {
    const React = runtime.React;
    const h = React.createElement;

    function MarkdownContent({ ctx }) {
        const [editing, setEditing] = React.useState(false);
        const value = ctx.node.metadata?.content || "";
        const html = React.useMemo(() => DOMPurify.sanitize(String(marked.parse(value || "*双击正文或点击右上角按钮编辑 Markdown*")), { USE_PROFILES: { html: true } }), [value]);
        const toggle = { position: "absolute", right: 8, top: 8, zIndex: 20, width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, border: `1px solid ${ctx.theme.node.stroke}`, background: `${ctx.theme.toolbar.panel}dd`, color: ctx.theme.node.text, cursor: "pointer" };
        const stopMouse = (event) => event.stopPropagation();
        return h(
            "div",
            { "data-canvas-no-zoom": true, style: { position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column" } },
            h("button", { "data-canvas-no-drag": true, type: "button", style: toggle, onMouseDown: stopMouse, onClick: () => setEditing((current) => !current), title: editing ? "预览" : "编辑" }, editing ? "👁" : "✎"),
            editing
                ? h("textarea", { "data-canvas-no-drag": true, autoFocus: true, value, placeholder: "# 输入 Markdown", onMouseDown: stopMouse, onDoubleClick: stopMouse, onWheel: stopMouse, onChange: (event) => ctx.updateMetadata({ content: event.target.value }), style: { height: "100%", width: "100%", resize: "none", background: "transparent", padding: 16, fontFamily: "monospace", fontSize: 14, outline: "none", border: "none", color: ctx.theme.node.text } })
                : h("div", { className: "cnv-md", onWheel: stopMouse, style: { color: ctx.theme.node.text }, dangerouslySetInnerHTML: { __html: html } }),
        );
    }

    return { id: "markdown", name: "Markdown 节点", version: "1.0.0", description: "在画布中安全编辑与渲染 Markdown", css, nodes: [{ type: "markdown:doc", title: "Markdown", icon: "📝", description: "编辑与渲染 Markdown", defaultSize: { width: 360, height: 300 }, defaultMetadata: { content: "" }, minimapColor: "#6366f1", resource: (node) => ({ kind: "text", text: node.metadata?.content }), Content: MarkdownContent }] };
}
