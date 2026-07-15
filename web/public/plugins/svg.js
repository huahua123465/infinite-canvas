import DOMPurify from "./vendor/purify-3.4.12.es.mjs";

const DEFAULT_SVG = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#6366f1"/></svg>';

function sanitizeSvg(value) {
    return DOMPurify.sanitize(value, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["script", "foreignObject"], FORBID_ATTR: ["href", "xlink:href"] });
}

export default function createSvgPlugin(runtime) {
    const React = runtime.React;
    const h = React.createElement;

    function SvgContent({ ctx }) {
        const [editing, setEditing] = React.useState(false);
        const stored = ctx.node.metadata?.content;
        const upstream = ctx.getUpstream().map((node) => node.metadata?.content).find((text) => text?.trim().startsWith("<svg"));
        const value = stored ?? "";
        const svg = React.useMemo(() => sanitizeSvg(value.trim() || upstream || DEFAULT_SVG), [upstream, value]);
        React.useEffect(() => {
            if (stored === undefined && upstream) ctx.updateMetadata({ content: upstream });
        }, [ctx, stored, upstream]);
        const toggle = { position: "absolute", right: 8, top: 8, zIndex: 20, width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, border: `1px solid ${ctx.theme.node.stroke}`, background: `${ctx.theme.toolbar.panel}dd`, color: ctx.theme.node.text, cursor: "pointer" };
        const stopMouse = (event) => event.stopPropagation();
        return h(
            "div",
            { "data-canvas-no-zoom": true, style: { position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column" } },
            h("button", { "data-canvas-no-drag": true, type: "button", style: toggle, onMouseDown: stopMouse, onClick: () => setEditing((current) => !current), title: editing ? "预览" : "编辑源码" }, editing ? "👁" : "✎"),
            editing
                ? h("textarea", { "data-canvas-no-drag": true, autoFocus: true, value, placeholder: DEFAULT_SVG, onMouseDown: stopMouse, onDoubleClick: stopMouse, onWheel: stopMouse, onChange: (event) => ctx.updateMetadata({ content: event.target.value }), style: { height: "100%", width: "100%", resize: "none", background: "transparent", padding: 16, fontFamily: "monospace", fontSize: 12, outline: "none", border: "none", color: ctx.theme.node.text } })
                : h("div", { style: { height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }, dangerouslySetInnerHTML: { __html: svg } }),
        );
    }

    return { id: "svg", name: "SVG 节点", version: "1.0.0", description: "编辑并安全渲染 SVG", nodes: [{ type: "svg:vector", title: "SVG", icon: "🔷", description: "安全渲染 SVG 矢量图", defaultSize: { width: 320, height: 320 }, defaultMetadata: {}, minimapColor: "#14b8a6", Content: SvgContent }] };
}
