"""沧元算力图片与视频适配器的协议映射测试。"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.contracts.image_generation import ImageGenerationInput
from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.cangyuan.images import CangyuanImageApiAdapter
from app.core.integrations.cangyuan.video import CangyuanVideoApiAdapter


def _patch_httpx_client(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    """让 adapter 使用 MockTransport，验证请求协议而不访问真实供应商。"""
    real_client = httpx.AsyncClient

    def factory(**kwargs: object) -> httpx.AsyncClient:
        return real_client(transport=transport, timeout=kwargs.get("timeout", 60.0))  # type: ignore[arg-type]

    monkeypatch.setattr(httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_cangyuan_banana_image_uses_platform_resolution_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Banana 模型使用 output_resolution/image_size，而不是 OpenAI size 字段。"""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert request.url.path == "/v1/images/generations"
        assert request.headers["authorization"] == "Bearer sk-test"
        assert body["output_resolution"] == "4K"
        assert body["image_size"] == "4K"
        assert "size" not in body
        return httpx.Response(200, json={"data": [{"url": "https://cdn.example/image.png"}]})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    result = await CangyuanImageApiAdapter().generate(
        cfg=ProviderConfig(provider="cangyuan", api_key="sk-test"),
        inp=ImageGenerationInput(model="banana-pro-4k", prompt="山村旧屋"),
        timeout_s=30,
    )
    assert result.provider == "cangyuan"
    assert result.images[0].url == "https://cdn.example/image.png"


@pytest.mark.asyncio
async def test_cangyuan_gpt_image_polls_async_task(monkeypatch: pytest.MonkeyPatch) -> None:
    """GPT Image 模型提交 async=true 后轮询到图片 URL。"""
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if request.method == "POST":
            body = json.loads(request.content.decode())
            assert body["async"] is True
            return httpx.Response(200, json={"task_id": "img-task-1", "status": "queued"})
        assert request.url.path.endswith("/img-task-1")
        return httpx.Response(200, json={"status": "completed", "data": [{"url": "https://cdn.example/gpt.png"}]})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    result = await CangyuanImageApiAdapter().generate(
        cfg=ProviderConfig(provider="cangyuan", api_key="sk-test"),
        inp=ImageGenerationInput(model="gpt-image-2", prompt="山路上的木杖"),
        timeout_s=30,
    )
    assert calls == 2
    assert result.provider_task_id == "img-task-1"


@pytest.mark.asyncio
async def test_cangyuan_video_uses_v1_video_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    """验证沧元视频创建、轮询和 Bearer 鉴权路径。"""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer sk-test"
        if request.method == "POST":
            body = json.loads(request.content.decode())
            assert request.url.path == "/v1/videos"
            assert body["aspect_ratio"] == "16:9"
            assert body["duration"] == 8
            assert body["resolution"] == "720p"
            assert body["image_url"].startswith("data:image/png;base64,")
            return httpx.Response(200, json={"task_id": "video-task-1"})
        assert request.url.path == "/v1/videos/video-task-1"
        return httpx.Response(200, json={"status": "completed", "data": [{"url": "https://cdn.example/out.mp4"}]})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    adapter = CangyuanVideoApiAdapter()
    cfg = ProviderConfig(provider="cangyuan", api_key="sk-test")
    task_id = await adapter.create_video(
        cfg=cfg,
        input_=VideoGenerationInput(
            model="seedance-2.0-720p",
            prompt="雨夜山村",
            ratio="16:9",
            seconds=8,
            key_frame_base64="aGVsbG8=",
        ),
        timeout_s=30,
    )
    meta = await adapter.get_video(cfg=cfg, video_id=task_id, timeout_s=30)
    assert task_id == "video-task-1"
    assert meta["status"] == "completed"


@pytest.mark.asyncio
async def test_cangyuan_video_maps_first_and_last_frames(monkeypatch: pytest.MonkeyPatch) -> None:
    """首尾帧模式应发送成对的 first_image_url 和 last_image_url。"""
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert "image_url" not in body
        assert body["first_image_url"].startswith("data:image/png;base64,")
        assert body["last_image_url"].startswith("data:image/png;base64,")
        return httpx.Response(200, json={"id": "video-task-2"})

    _patch_httpx_client(monkeypatch, httpx.MockTransport(handler))
    task_id = await CangyuanVideoApiAdapter().create_video(
        cfg=ProviderConfig(provider="cangyuan", api_key="sk-test"),
        input_=VideoGenerationInput(
            model="seedance-2.0",
            prompt="平滑过渡",
            ratio="16:9",
            seconds=5,
            first_frame_base64="Zmlyc3Q=",
            last_frame_base64="bGFzdA==",
        ),
        timeout_s=30,
    )
    assert task_id == "video-task-2"
