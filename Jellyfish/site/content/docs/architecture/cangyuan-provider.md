---
title: "沧元算力供应商"
weight: 8
description: "Jellyfish 当前对沧元算力图片与视频接口的接入边界。"
---

## 当前能力

Jellyfish 通过 `cangyuan` provider 接入沧元算力，当前支持图片和视频模型，不将该供应商标记为文本模型供应商。

默认 Base URL 为 `https://ai.cangyuansuanli.cn`。请求鉴权统一使用：

```text
Authorization: Bearer sk-...
```

## 图片接口

图片请求使用：

```text
POST /v1/images/generations
```

Banana 模型使用 `output_resolution` 和 `image_size` 的 `1K` / `2K` / `4K` 档位；GPT Image 模型使用 `size`，并按文档走异步任务轮询。JSON 图生图使用 `image`，最多支持 9 张参考图。

## 视频接口

视频请求使用：

```text
POST /v1/videos
GET /v1/videos/{task_id}
GET /v1/videos/{task_id}/content
```

Jellyfish 将统一的 `ratio`、`seconds` 和分镜参考帧映射为沧元字段：

- `ratio` -> `aspect_ratio`
- `seconds` -> `duration`
- 模型名中的 `480p` / `720p` -> `resolution`
- 单参考帧 -> `image_url`
- 首尾帧 -> 成对的 `first_image_url` / `last_image_url`

Seedance 2.0 按文档约束时长为 4 至 15 秒。任务状态使用 `queued`、`in_progress`、`completed`、`failed`，成功结果优先使用响应中的 `video_url` 或 `data[0].url`，缺失时回退到 content 地址。

## 页面配置

在模型管理页添加供应商时选择“沧元算力”，填写：

- 文本/通用 Base URL：`https://ai.cangyuansuanli.cn`
- 图片 Base URL：留空
- 视频 Base URL：留空
- API Key：沧元算力控制台生成的 `sk-...` 令牌
- API Secret：留空

然后为该供应商分别创建图片模型和视频模型，模型名必须与沧元算力模型广场的公开名称一致，例如 `banana-pro-4k`、`gpt-image-2` 或 `seedance-2.0-720p`。
## Model discovery

The model management flow keeps provider credentials separate from persisted model records. After a provider is saved, the frontend calls `GET /api/v1/llm/providers/{provider_id}/discover-models` and lets the user select a returned model by capability category. Model parameters are maintained by the provider integration and are not entered as free-form JSON in the model form.

The endpoint first attempts the provider's OpenAI-compatible `/models` catalog. Cangyuan uses `/v1/models` when needed and falls back to the supported Cangyuan image/video catalog when the remote catalog is unavailable. API keys are never included in the response.
