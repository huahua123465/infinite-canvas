"""沧元算力视频生成 API 适配器。"""

from __future__ import annotations

from typing import Any

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.cangyuan.video_capabilities import validate_cangyuan_video_options
from app.core.integrations.openai.video_payload import to_image_data_url


class CangyuanVideoApiAdapter:
    """调用沧元算力 `/v1/videos` 的创建和状态查询接口。"""

    async def create_video(
        self,
        *,
        cfg: ProviderConfig,
        input_: VideoGenerationInput,
        timeout_s: float,
    ) -> str:
        """提交视频生成任务并返回沧元算力任务 ID。"""
        import httpx

        validate_cangyuan_video_options(input_)
        base_url = (cfg.base_url or "https://ai.cangyuansuanli.cn").rstrip("/")
        body: dict[str, Any] = {
            "model": input_.model,
            "prompt": input_.prompt or "",
            "aspect_ratio": input_.ratio,
        }
        if input_.seconds is not None:
            body["duration"] = int(input_.seconds)
        _add_reference_images(body, input_)
        resolution = _resolve_resolution(input_.model)
        if resolution:
            body["resolution"] = resolution
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(
                f"{base_url}/v1/videos",
                headers={"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"},
                json=body,
            )
            response.raise_for_status()
            data = response.json()
        task_id = str(data.get("task_id") or data.get("id") or "").strip()
        if not task_id:
            raise RuntimeError(f"Cangyuan video response has no task id: {data!r}")
        return task_id

    async def get_video(
        self,
        *,
        cfg: ProviderConfig,
        video_id: str,
        timeout_s: float,
    ) -> dict[str, Any]:
        """查询沧元算力视频任务状态及已生成的视频 URL。"""
        import httpx

        base_url = (cfg.base_url or "https://ai.cangyuansuanli.cn").rstrip("/")
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.get(
                f"{base_url}/v1/videos/{video_id}",
                headers={"Authorization": f"Bearer {cfg.api_key}"},
            )
            response.raise_for_status()
            return response.json()


def _add_reference_images(body: dict[str, Any], input_: VideoGenerationInput) -> None:
    """将通用首帧/尾帧/关键帧字段映射为沧元算力视频参考图字段。"""
    first = input_.first_frame_base64
    last = input_.last_frame_base64
    key = input_.key_frame_base64
    if first and last:
        body["first_image_url"] = to_image_data_url(first)
        body["last_image_url"] = to_image_data_url(last)
        return
    reference = key or first or last
    if reference:
        body["image_url"] = to_image_data_url(reference)


def _resolve_resolution(model: str | None) -> str | None:
    """从沧元算力公开模型名提取视频清晰度字段。"""
    value = (model or "").strip().lower()
    for suffix, resolution in (("480p", "480p"), ("720p", "720p"), ("1080p", "1080p"), ("4k", "4K")):
        if suffix in value:
            return resolution
    return None
