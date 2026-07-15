# 插件模板(TypeScript + SDK)

复制本目录即可开始写一个新的画布节点插件。

## 上手

```bash
cp -r plugins/canvas/template plugins/canvas/my-plugin
cd plugins/canvas/my-plugin
# 改 package.json 的 name;改 src/index.tsx 里的 id / name / type
npm install
npm run dev      # watch 构建,产物同步到 web/public/plugins/my-plugin.js
npm run typecheck
```

然后启动画布 `web`,在「节点插件」管理器的第三方插件地址中填 `/plugins/my-plugin.js` 安装。也可用 `VITE_DEV_PLUGINS=/plugins/my-plugin.js` 做刷新即加载的本地调试。构建助手不会自动修改内置插件清单,避免开发产物在其他环境被默认发现或执行。发布时把 `dist/<name>.js` 托管到任意静态地址,用户填 URL 安装。

> 产物名取**目录名**(`my-plugin/` → `my-plugin.js`),所以复制后记得把目录改成你的插件名。

## 你只需要关心

- `src/index.tsx` 里 `Content({ ctx })` 的节点 UI 与逻辑;
- `definePlugin({...})` 里的 `id` / `nodes[].type` / `defaultSize` 等元信息。

类型、JSX、宿主 React、构建都由 `@infinite-canvas/plugin-sdk` 提供,写 TSX 全程有补全。`ctx` 的完整能力见 `plugins/canvas/README.md` 与 SDK 的类型定义。
