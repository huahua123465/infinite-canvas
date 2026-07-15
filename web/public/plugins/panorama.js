import * as THREE from "./vendor/three-0.180.0.module.js";

export default function createPanoramaPlugin(runtime) {
    const React = runtime.React;
    const h = React.createElement;

    function PanoramaContent({ ctx }) {
        const mountRef = React.useRef(null);
        const [error, setError] = React.useState("");
        const upstreamImage = ctx.getUpstream().find((node) => node.type === "image" && node.metadata?.content)?.metadata?.content;
        const source = ctx.node.metadata?.content || upstreamImage;
        React.useEffect(() => {
            const mount = mountRef.current;
            setError("");
            if (!mount || !source) return;
            try {
                return mountPanorama(mount, source, setError);
            } catch (reason) {
                setError(reason instanceof Error ? reason.message : String(reason));
            }
        }, [source]);
        if (!source) return h("div", { style: { height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: ctx.theme.node.placeholder } }, h("span", { style: { fontSize: 26 } }, "🌐"), h("span", { style: { fontSize: 14 } }, "连接一个全景图片节点"));
        return h(
            "div",
            { "data-canvas-no-zoom": true, "data-canvas-no-drag": true, onMouseDown: (event) => event.stopPropagation(), onWheel: (event) => event.stopPropagation(), style: { position: "relative", height: "100%", width: "100%", overflow: "hidden", borderRadius: 16, background: "#000" } },
            h("div", { ref: mountRef, style: { height: "100%", width: "100%" } }),
            error ? h("div", { style: { position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 20, color: "#fecaca", background: "rgba(0,0,0,.72)", fontSize: 13, textAlign: "center" } }, `全景加载失败：${error}`) : null,
        );
    }

    return { id: "panorama", name: "3D 全景节点", version: "1.0.0", description: "使用仓库内置 Three.js 查看 360° 等距柱状全景图", nodes: [{ type: "panorama:viewer", title: "3D 全景", icon: "🌐", description: "360° 全景查看器", defaultSize: { width: 480, height: 300 }, defaultMetadata: {}, minimapColor: "#0ea5e9", Content: PanoramaContent }] };
}

function mountPanorama(mount, source, onError) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);
    const geometry = new THREE.SphereGeometry(50, 60, 40);
    geometry.scale(-1, 1, 1);
    const texture = new THREE.TextureLoader().load(source, undefined, undefined, (reason) => onError(reason instanceof ErrorEvent ? reason.message : "图片不可读取"));
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);
    let longitude = 0;
    let latitude = 0;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLongitude = 0;
    let startLatitude = 0;
    let frame = 0;
    const target = new THREE.Vector3();
    const canvas = renderer.domElement;
    canvas.style.cursor = "grab";
    const resize = () => {
        const width = Math.max(1, mount.clientWidth);
        const height = Math.max(1, mount.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();
    const onDown = (event) => {
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        startLongitude = longitude;
        startLatitude = latitude;
        canvas.style.cursor = "grabbing";
    };
    const onMove = (event) => {
        if (!dragging) return;
        longitude = startLongitude - (event.clientX - startX) * 0.2;
        latitude = Math.max(-85, Math.min(85, startLatitude + (event.clientY - startY) * 0.2));
    };
    const onUp = () => {
        dragging = false;
        canvas.style.cursor = "grab";
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    const animate = () => {
        frame = requestAnimationFrame(animate);
        if (!dragging) longitude += 0.03;
        const phi = THREE.MathUtils.degToRad(90 - latitude);
        const theta = THREE.MathUtils.degToRad(longitude);
        target.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
        camera.lookAt(target);
        renderer.render(scene, camera);
    };
    animate();
    return () => {
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        canvas.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        scene.remove(sphere);
        material.dispose();
        geometry.dispose();
        texture.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
    };
}
