"""沧元算力图像模型的能力约束与模型前缀覆盖。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.integrations.image_capabilities import ImageModelCapability

if TYPE_CHECKING:
    from app.core.contracts.image_generation import ImageGenerationInput


_CANGYUAN_RATIO_SIZE_PROFILES = {
    "1:1": {"standard": "1024x1024", "high": "2048x2048"},
    "4:3": {"standard": "1152x896", "high": "2048x1536"},
    "3:4": {"standard": "896x1152", "high": "1536x2048"},
    "16:9": {"standard": "1344x768", "high": "2048x1152"},
    "9:16": {"standard": "768x1344", "high": "1152x2048"},
    "3:2": {"standard": "1216x832", "high": "2048x1365"},
    "2:3": {"standard": "832x1216", "high": "1365x2048"},
    "21:9": {"standard": "1536x640", "high": "2304x1024"},
}

_CANGYUAN_DEFAULT = ImageModelCapability(
    supports_seed=False,
    supports_watermark=False,
    allowed_sizes={
        size
        for profiles in _CANGYUAN_RATIO_SIZE_PROFILES.values()
        for size in profiles.values()
    },
    supported_ratios=set(_CANGYUAN_RATIO_SIZE_PROFILES),
    default_resolution_profile="standard",
    ratio_size_profiles=_CANGYUAN_RATIO_SIZE_PROFILES,
    max_n=9,
)

_CANGYUAN_MODEL_OVERRIDES: dict[str, ImageModelCapability] = {}


def register_cangyuan_image_capability(*, model_prefix: str, capability: ImageModelCapability) -> None:
    """注册沧元算力图片模型能力覆盖，供模型差异化校验使用。"""
    prefix = model_prefix.strip().lower()
    if not prefix:
        raise ValueError("model_prefix must not be empty")
    _CANGYUAN_MODEL_OVERRIDES[prefix] = capability


def clear_cangyuan_image_capability_overrides() -> None:
    """清空沧元算力图片模型覆盖，供测试和运行时重置使用。"""
    _CANGYUAN_MODEL_OVERRIDES.clear()


def _pick_override(model: str | None) -> ImageModelCapability | None:
    value = (model or "").strip().lower()
    for prefix, capability in sorted(
        _CANGYUAN_MODEL_OVERRIDES.items(), key=lambda item: len(item[0]), reverse=True
    ):
        if value.startswith(prefix):
            return capability
    return None


def resolve_cangyuan_image_capability(model: str | None) -> ImageModelCapability:
    """解析沧元算力图片模型能力，未知模型使用平台通用约束。"""
    return _pick_override(model) or _CANGYUAN_DEFAULT


def validate_cangyuan_image_options(input_: ImageGenerationInput) -> None:
    """在发起请求前校验沧元算力图片参数，避免无效请求消耗额度。"""
    from app.core.integrations.image_capabilities import validate_image_options

    validate_image_options(provider="cangyuan", model=input_.model, input_=input_)
