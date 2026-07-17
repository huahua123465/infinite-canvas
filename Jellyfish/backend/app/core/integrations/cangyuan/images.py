"""沧元算力图像生成 API 适配器。"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from app.core.contracts.image_generation import ImageGenerationInput, ImageGenerationResult, ImageItem
from app.core.contracts.provider import ProviderConfig
from app.core.integrations.cangyuan.image_capabilities import validate_cangyuan_image_options
from app.core.integrations.image_capabilities import resolve_image_size


class CangyuanImageApiAdapter:
    """调用沧元算力 `/v1/images/generations`，兼容同步和异步图片任务。"""

    async def generate(
        self,
        *,
        cfg: ProviderConfig,
        inp: ImageGenerationInput,
        timeout_s: float,
    ) -> ImageGenerationResult:
        """提交图片生成请求，并在平台返回任务 ID 时轮询到最终图片。"""
        import httpx

        resolved_size = resolve_image_size(
            provider="cangyuan",
            model=inp.model,
            purpose=inp.purpose,
            target_ratio=inp.target_ratio,
            resolution_profile=inp.resolution_profile,
            requested_size=inp.size,
        )
        resolved_input = inp.model_copy(update={"size": resolved_size})
        validate_cangyuan_image_options(resolved_input)
        base_url = (cfg.base_url or "https://ai.cangyuansuanli.cn").rstrip("/")
        headers = {"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"}
        body = _build_image_body(resolved_input)
        deadline = time.monotonic() + max(timeout_s, 1.0)

        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(
                f"{base_url}/v1/images/generations", headers=headers, json=body
            )
            response.raise_for_status()
            data = response.json()
            result = _parse_images_payload(data)
            if result is not None:
                return result

            task_id = _task_id(data)
            if not task_id:
                raise RuntimeError(f"Cangyuan image response has no data or task id: {data!r}")
            while time.monotonic() < deadline:
                await asyncio.sleep(3)
                poll = await client.get(
                    f"{base_url}/v1/images/generations/{task_id}", headers=headers
                )
                poll.raise_for_status()
                poll_data = poll.json()
                status = str(poll_data.get("status") or "")
                if status == "failed":
                    raise RuntimeError(f"Cangyuan image task failed: {poll_data!r}")
                result = _parse_images_payload(poll_data, task_id=task_id)
                if result is not None:
                    return result
            raise TimeoutError(f"Cangyuan image task timed out: task_id={task_id}")


def _build_image_body(inp: ImageGenerationInput) -> dict[str, Any]:
    """将通用图片输入映射为沧元算力文档定义的 JSON 请求。"""
    model = (inp.model or "").strip().lower()
    is_banana = model.startswith("banana") or model.startswith("gemini-banana")
    is_gpt_image = model.startswith("gpt-image")
    body: dict[str, Any] = {"prompt": inp.prompt, "stream": False}
    if inp.model:
        body["model"] = inp.model
    if inp.target_ratio:
        body["aspect_ratio"] = inp.target_ratio
    if is_banana:
        profile = _banana_resolution(model)
        body["output_resolution"] = profile
        body["image_size"] = profile
    elif inp.size:
        body["size"] = inp.size
    if inp.response_format:
        body["response_format"] = inp.response_format
    if is_gpt_image:
        body["async"] = True
        body["n"] = inp.n
    refs = [ref.image_url for ref in inp.images if ref.image_url]
    if refs:
        body["image"] = refs[0] if len(refs) == 1 else refs
    return body


def _banana_resolution(model: str) -> str:
    """根据 Banana 模型名映射文档要求的 1K/2K/4K 档位。"""
    for profile in ("4K", "2K", "1K"):
        if profile.lower() in model:
            return profile
    return "1K"


def _task_id(data: dict[str, Any]) -> str:
    """从平台响应中提取异步图片任务 ID。"""
    return str(data.get("task_id") or data.get("id") or "").strip()


def _parse_images_payload(
    data: dict[str, Any], *, task_id: str | None = None
) -> ImageGenerationResult | None:
    """解析同步或轮询响应中的 `data[].url` / `b64_json` 图片结果。"""
    images: list[ImageItem] = []
    for item in data.get("data") or []:
        if not isinstance(item, dict):
            continue
        url = item.get("url") or item.get("image_url")
        b64 = item.get("b64_json")
        if url or b64:
            images.append(ImageItem(url=url, b64_json=b64))
    if not images:
        return None
    return ImageGenerationResult(
        images=images,
        provider="cangyuan",
        provider_task_id=task_id or _task_id(data) or None,
        status=str(data.get("status") or "succeeded"),
    )
