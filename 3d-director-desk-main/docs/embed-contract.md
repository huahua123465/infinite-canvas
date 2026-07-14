# 3D 导演台嵌入协议

这个项目是独立 Vite 应用。推荐用 iframe 引入，不要把 Three.js 依赖打进宿主项目。

## iframe 地址

同源部署时：

```html
<iframe src="/director-desk/?instanceId=node_123&theme=dark"></iframe>
```

本地跨端口开发时，必须带 `hostOrigin`：

```html
<iframe
  src="http://localhost:5173/?instanceId=node_123&theme=dark&hostOrigin=http%3A%2F%2Flocalhost%3A3000"
></iframe>
```

参数：

| 参数 | 说明 |
| --- | --- |
| `instanceId` | 当前导演台实例 ID。导演台会按这个 ID 做 localStorage 场景隔离。 |
| `theme` | `dark` 或 `light`。 |
| `hostOrigin` | 父页面 origin。跨端口/跨域 iframe 通信时必填。 |

同一个 `instanceId` 会恢复同一个导演台工程；不同 `instanceId` 会隔离保存。独立打开时，顶部也可以在“导演台 1 号 / 导演台 2 号”等本地实例之间切换。

不带 `instanceId` 直接访问根地址时，会显示导演台首页，让用户选择、新建或删除本地导演台。

## 子应用发给宿主

### ready

导演台初始化完成：

```ts
{
  type: "storyai:director-desk-ready"
}
```

### close

用户点击右上角关闭：

```ts
{
  type: "storyai:director-desk-close"
}
```

### captures-sent

用户把机位截图发送回宿主：

```ts
{
  type: "storyai:director-desk-captures-sent",
  payload: {
    captures: [
      {
        dataUrl: "data:image/png;base64,...",
        fileName: "机位01-截图01.png"
      }
    ]
  }
}
```

宿主收到后建议：

1. 把 `dataUrl` 转成文件，保存到宿主自己的素材/本地数据层；
2. 在画布上创建图片节点；
3. 不要长期把大 base64 存进普通 localStorage。

## 宿主发给子应用

### session

打开或切换一个导演台实例：

```ts
iframe.contentWindow?.postMessage(
  {
    type: "storyai:director-desk-session",
    payload: {
      instanceId: "node_123",
      theme: "dark"
    }
  },
  "http://localhost:5173"
);
```

### panorama

全景图功能已关闭。旧宿主如果仍发送 `storyai:director-desk-panorama`，导演台会忽略这条消息，不再导入背景图。

## 无限画布侧推荐接法

最小接入只需要做一个“打开外部导演台”的入口：

1. 无限画布打开弹窗/新窗口，里面放 iframe；
2. iframe URL 带 `instanceId`、`theme`、`hostOrigin`；
3. 监听 `storyai:director-desk-captures-sent`，把截图落成图片节点。

这样 Three.js、R3F、模型加载、截图逻辑都留在独立导演台里，不污染无限画布主应用。
