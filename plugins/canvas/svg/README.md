# SVG 节点插件

Infinite Canvas 画布节点插件:编辑与渲染 SVG,无自身内容时自动取上游文本节点里的 SVG 源码。

所有 SVG 在渲染前使用 DOMPurify 的 SVG profile 净化，并禁用脚本、`foreignObject`、`href` 和 `xlink:href`，避免事件属性、HTML 嵌入和外部资源执行。

## 构建

```bash
npm install
npm run build      # 产物 dist/svg.js,并同步到 web/public/plugins/svg.js
npm run dev        # watch
```

## 安装

画布 → 左上菜单「节点插件」→ 安装 URL 填 `/plugins/svg.js`(或托管后的公网 URL)。

插件契约见 `plugins/canvas/README.md`。
