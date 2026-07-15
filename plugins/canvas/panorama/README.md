# 3D 全景节点插件

Infinite Canvas 画布节点插件:查看 360° 等距柱状(equirectangular)全景图,可拖拽旋转。可从上游图片节点自动取图。

Three.js 固定为 `0.180.0` 并随插件构建，不依赖运行时 CDN。节点卸载或图片切换时会清理动画帧、ResizeObserver、全局指针监听器、纹理、材质、几何体和 WebGL 上下文。

## 构建

```bash
npm install
npm run build      # 产物 dist/panorama.js,并同步到 web/public/plugins/panorama.js
npm run dev        # watch
```

## 安装

画布 → 左上菜单「节点插件」→ 安装 URL 填 `/plugins/panorama.js`(或托管后的公网 URL)。连接一个全景图片节点到本节点即可查看。

插件契约见 `plugins/canvas/README.md`。
