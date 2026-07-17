"""Celery 应用实例。

最小落地原则：
- 仅把 Celery 当作执行层与 broker 客户端；
- 任务状态/结果真相仍然回写 GenerationTask；
- 第一阶段不依赖 Celery result backend。
"""

from pathlib import Path

from celery import Celery
from celery.signals import worker_process_init

from app.config import settings
from app.core.db import reset_db_runtime


_runtime_root = Path(__file__).resolve().parents[2] / ".runtime" / "celery"
_runtime_root.mkdir(parents=True, exist_ok=True)
_broker_url = settings.celery_broker_url or "filesystem://"
_broker_options = (
    {
        "data_folder_in": str(_runtime_root),
        "data_folder_out": str(_runtime_root),
        "control_folder": str(_runtime_root),
        "store_processed": True,
    }
    if _broker_url.startswith("filesystem://")
    else {}
)

celery_app = Celery(
    "jellyfish",
    broker=_broker_url,
    include=["app.tasks.execute_task"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_ignore_result=True,
    timezone="Asia/Shanghai",
    enable_utc=False,
    broker_transport_options=_broker_options,
)


@worker_process_init.connect
def _reset_async_db_runtime(**_: object) -> None:
    """Celery prefork 子进程启动后，重建 async DB 运行时。"""

    reset_db_runtime()
