# HTML 节点插件

Infinite Canvas 画布节点插件:用沙箱 iframe 渲染 HTML。源码里的 `{{input}}` 会被替换为上游文本节点内容。

iframe 不启用同源权限，只允许内联脚本；内置 CSP 禁止网络请求、表单提交和外部脚本，上游 `{{input}}` 会先进行 HTML 转义。

## 构建

```bash
npm install
npm run build      # 产物 dist/html.js,并同步到 web/public/plugins/html.js
npm run dev        # watch
```

## 安装

画布 → 左上菜单「节点插件」→ 安装 URL 填 `/plugins/html.js`(或托管后的公网 URL)。

插件契约见 `plugins/canvas/README.md`。
