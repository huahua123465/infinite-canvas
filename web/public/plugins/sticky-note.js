export default function createStickyNotePlugin(runtime) {
    const React = runtime.React;
    const h = React.createElement;
    const colors = ["#fde68a", "#fca5a5", "#a7f3d0", "#bfdbfe", "#ddd6fe"];

    function StickyNoteContent({ ctx }) {
        const [editing, setEditing] = React.useState(false);
        const color = ctx.node.metadata?.pluginColor || colors[0];
        const content = ctx.node.metadata?.content || "";
        const buttonStyle = { width: 26, height: 26, borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(0,0,0,.08)", fontSize: 13 };
        const cycleColor = () => ctx.updateMetadata({ pluginColor: colors[(colors.indexOf(color) + 1) % colors.length] });
        const spawnTextNode = () => {
            const id = `sticky-${ctx.node.id}-${ctx.getNodes().length}`;
            ctx.applyOps([
                { type: "add_node", id, nodeType: "text", title: "便利贴衍生", x: ctx.node.position?.x || 0, y: (ctx.node.position?.y || 0) + 260, metadata: { content, status: "success" } },
                { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
            ]);
        };
        const stopMouse = (event) => event.stopPropagation();
        return h(
            "div",
            {
                "data-canvas-no-zoom": true,
                onDoubleClick: (event) => {
                    if (event.target instanceof Element && event.target.closest("[data-canvas-no-drag]")) return;
                    event.stopPropagation();
                    setEditing(true);
                },
                style: { position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column", background: color, borderRadius: 16, padding: 12, boxSizing: "border-box" },
            },
            h(
                "div",
                { "data-canvas-no-drag": true, onMouseDown: stopMouse, style: { display: "flex", gap: 6, justifyContent: "flex-end", marginBottom: 6 } },
                h("button", { type: "button", title: "换颜色", onClick: cycleColor, style: buttonStyle }, "🎨"),
                h("button", { type: "button", title: "衍生文本节点", onClick: spawnTextNode, style: buttonStyle }, "➡️"),
                h("button", { type: "button", title: editing ? "完成" : "编辑", onClick: () => setEditing((value) => !value), style: buttonStyle }, editing ? "✓" : "✎"),
            ),
            editing
                ? h("textarea", { "data-canvas-no-drag": true, autoFocus: true, value: content, onMouseDown: stopMouse, onDoubleClick: stopMouse, onWheel: stopMouse, onChange: (event) => ctx.updateMetadata({ content: event.target.value }), style: { flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", color: "#1c1917", fontSize: 15, lineHeight: 1.5 } })
                : h("div", { style: { flex: 1, whiteSpace: "pre-wrap", overflow: "auto", color: "#1c1917", fontSize: 15, lineHeight: 1.5 } }, content || "双击正文或点击 ✎ 编辑便利贴"),
        );
    }

    return {
        id: "sticky-note",
        name: "便利贴节点",
        version: "1.0.0",
        description: "可换色、可编辑、可衍生文本节点的便利贴",
        nodes: [{ type: "sticky-note:note", title: "便利贴", icon: "📌", description: "彩色便利贴", defaultSize: { width: 240, height: 200 }, defaultMetadata: { content: "", pluginColor: colors[0] }, minimapColor: "#f59e0b", resource: (node) => ({ kind: "text", text: node.metadata?.content }), Content: StickyNoteContent }],
    };
}
