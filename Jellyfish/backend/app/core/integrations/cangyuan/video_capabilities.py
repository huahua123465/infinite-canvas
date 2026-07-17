"""沧元算力视频模型的能力约束与模型前缀覆盖。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.integrations.video_capabilities import ALLOWED_RATIOS, VideoModelCapability

if TYPE_CHECKING:
    from app.core.contracts.video_generation import VideoGenerationInput


_CANGYUAN_DEFAULT = VideoModelCapability(
    supports_seed=False,
    supports_watermark=False,
    allowed_ratios=set(ALLOWED_RATIOS),
    default_ratio="16:9",
    min_seconds=1,
    max_seconds=15,
)
_CANGYUAN_MODEL_OVERRIDES: dict[str, VideoModelCapability] = {}


def register_cangyuan_video_capability(*, model_prefix: str, capability: VideoModelCapability) -> None:
    """注册沧元算力视频模型能力覆盖，供不同模型做参数校验。"""
    prefix = model_prefix.strip().lower()
    if not prefix:
        raise ValueError("model_prefix must not be empty")
    _CANGYUAN_MODEL_OVERRIDES[prefix] = capability


register_cangyuan_video_capability(
    model_prefix="seedance-2.0",
    capability=VideoModelCapability(
        supports_seed=False,
        supports_watermark=False,
        allowed_ratios=set(ALLOWED_RATIOS),
        default_ratio="16:9",
        min_seconds=4,
        max_seconds=15,
    ),
)


def clear_cangyuan_video_capability_overrides() -> None:
    """清空沧元算力视频模型覆盖，供测试和运行时重置使用。"""
    _CANGYUAN_MODEL_OVERRIDES.clear()


def _pick_override(model: str | None) -> VideoModelCapability | None:
    value = (model or "").strip().lower()
    for prefix, capability in sorted(
        _CANGYUAN_MODEL_OVERRIDES.items(), key=lambda item: len(item[0]), reverse=True
    ):
        if value.startswith(prefix):
            return capability
    return None


def resolve_cangyuan_video_capability(model: str | None) -> VideoModelCapability:
    """解析沧元算力视频模型能力，未知模型使用平台通用约束。"""
    return _pick_override(model) or _CANGYUAN_DEFAULT


def validate_cangyuan_video_options(input_: VideoGenerationInput) -> None:
    """在发起请求前校验沧元算力视频参数，避免无效请求消耗额度。"""
    from app.core.integrations.video_capabilities import validate_video_options

    validate_video_options(provider="cangyuan", model=input_.model, input_=input_)
