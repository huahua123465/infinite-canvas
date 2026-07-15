# 仓库内置可选插件

此目录保存已审查的浏览器 ESM 产物。`catalog.json` 只包含静态元信息；打开插件管理器不会导入这些 JS，用户点击“安装”后才执行对应模块。

## 源码对应

| 产物 | 源码 |
| --- | --- |
| `sticky-note.js` | `plugins/canvas/sticky-note/src/index.tsx` |
| `html.js` | `plugins/canvas/html/src/index.tsx` |
| `markdown.js` | `plugins/canvas/markdown/src/index.tsx` |
| `svg.js` | `plugins/canvas/svg/src/index.tsx` |
| `panorama.js` | `plugins/canvas/panorama/src/index.tsx` |

## 依赖与安全边界

- Markdown 使用仓库内 `marked 17.0.6` 和 `DOMPurify 3.4.12`，解析结果净化后才写入 DOM。
- SVG 使用 DOMPurify SVG profile，并禁止脚本、`foreignObject`、`href` 和 `xlink:href`。
- HTML 使用无同源权限的 sandbox iframe、CSP 和上游文本转义。
- 3D 全景使用仓库内 `Three.js 0.180.0`，卸载时清理动画、监听器、纹理和 WebGL 上下文。
- 第三方依赖许可证保存在 `vendor/licenses/`。

更新插件源码时必须同步更新对应浏览器 ESM、`catalog.json` 版本和依赖许可证。不要创建 `/plugins/index.json` 自动发现清单；内置插件必须保持默认未安装、未启用。
