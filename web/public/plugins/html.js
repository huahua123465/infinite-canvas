const HTML_ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character] || character);
}

export default function createHtmlPlugin(runtime) {
    const React = runtime.React;
    const h = React.createElement;

    function HtmlContent({ ctx }) {
        const [editing, setEditing] = React.useState(false);
        const value = ctx.node.metadata?.content || "";
        const upstreamText = React.useMemo(() => ctx.getUpstream().map((node) => node.metadata?.content).filter(Boolean).join("\n"), [ctx]);
        const html = value.replace(/\{\{\s*input\s*\}\}/g, escapeHtml(upstreamText));
        const srcDoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; media-src data: blob: https:; font-src data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'">${html}`;
        const toggle = { position: "absolute", right: 8, top: 8, zIndex: 20, width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, border: `1px solid ${ctx.theme.node.stroke}`, background: `${ctx.theme.toolbar.panel}dd`, color: ctx.theme.node.text, cursor: "pointer" };
        const stopMouse = (event) => event.stopPropagation();
        return h(
            "div",
            { "data-canvas-no-zoom": true, style: { position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column" } },
            h("button", { "data-canvas-no-drag": true, type: "button", style: toggle, onMouseDown: stopMouse, onClick: () => setEditing((current) => !current), title: editing ? "预览" : "编辑源码" }, editing ? "👁" : "✎"),
            editing
                ? h("textarea", { "data-canvas-no-drag": true, autoFocus: true, value, placeholder: "<div>Hello, {{input}}</div>", onMouseDown: stopMouse, onDoubleClick: stopMouse, onWheel: stopMouse, onChange: (event) => ctx.updateMetadata({ content: event.target.value }), style: { height: "100%", width: "100%", resize: "none", background: "transparent", padding: 16, fontFamily: "monospace", fontSize: 12, outline: "none", border: "none", color: ctx.theme.node.text } })
                : value
                  ? h("iframe", { "data-canvas-no-drag": true, title: "html-preview", sandbox: "allow-scripts", referrerPolicy: "no-referrer", style: { height: "100%", width: "100%", border: 0, borderRadius: 16, background: "#fff" }, srcDoc })
                  : h("div", { style: { height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: ctx.theme.node.placeholder } }, h("span", { style: { fontSize: 26 } }, "</>"), h("span", { style: { fontSize: 14 } }, "编辑 HTML 源码")),
        );
    }

    return { id: "html", name: "HTML 节点", version: "1.0.0", description: "沙箱 iframe 渲染 HTML,支持 {{input}} 注入上游文本", nodes: [{ type: "html:render", title: "HTML", icon: "🌐", description: "沙箱渲染 HTML", defaultSize: { width: 420, height: 320 }, defaultMetadata: { content: "" }, minimapColor: "#ec4899", Content: HtmlContent }] };
}
