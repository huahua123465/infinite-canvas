"""统一 Celery 执行入口。

职责：
- Celery 统一只接收业务 task_id；
- 通过 GenerationTask.task_kind + registry 找到具体 WorkerTaskExecutor；
- 回写 executor_type / executor_task_id，便于排障。
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

from celery.result import AsyncResult

from app.core.celery_app import celery_app
from app.config import settings
from app.core.db_sync import sync_session_maker
from app.models.task import GenerationTask
from app.services.worker.task_registry import task_executor_registry

logger = logging.getLogger(__name__)
_local_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="jellyfish-task")


def _record_executor_dispatch(task_id: str, *, executor_type: str, executor_task_id: str | None) -> None:
    with sync_session_maker() as db:
        row = db.get(GenerationTask, task_id)
        if row is None:
            return
        row.executor_type = executor_type
        row.executor_task_id = executor_task_id
        db.commit()


def enqueue_task_execution(task_id: str) -> AsyncResult:
    if settings.task_executor_mode.lower() == "local":
        local_task_id = f"local-{task_id}"
        _record_executor_dispatch(task_id, executor_type="local", executor_task_id=local_task_id)
        _local_executor.submit(run_task_local, task_id)
        return SimpleNamespace(id=local_task_id)  # type: ignore[return-value]
    async_result = run_task_celery.delay(task_id)
    _record_executor_dispatch(
        task_id,
        executor_type="celery",
        executor_task_id=async_result.id,
    )
    return async_result


def run_task_local(task_id: str) -> None:
    """在 API 进程的后台线程执行本地任务，免除 Docker/Redis 前置依赖。"""
    try:
        with sync_session_maker() as db:
            row = db.get(GenerationTask, task_id)
            if row is None:
                return
            task_kind = (row.task_kind or "").strip() or str((row.payload or {}).get("task_kind") or "").strip()
        task_executor_registry.resolve(task_kind).run(task_id)
    except Exception:  # noqa: BLE001
        logger.exception("local task execution failed: task_id=%s", task_id)


def revoke_task_execution(task_id: str, *, terminate: bool = True, signal: str = "SIGTERM") -> bool:
    with sync_session_maker() as db:
        row = db.get(GenerationTask, task_id)
        if row is None:
            return False
        if (row.executor_type or "").strip() not in {"celery", "local"}:
            return False
        executor_task_id = (row.executor_task_id or "").strip()
        if not executor_task_id:
            return False

    try:
        AsyncResult(executor_task_id, app=celery_app).revoke(terminate=terminate, signal=signal)
    except Exception:  # noqa: BLE001
        logger.exception("failed to revoke celery task: task_id=%s executor_task_id=%s", task_id, executor_task_id)
        return False
    return True


@celery_app.task(name="task.execute")
def run_task_celery(task_id: str) -> None:
    with sync_session_maker() as db:
        row = db.get(GenerationTask, task_id)
        if row is None:
            return
        task_kind = (row.task_kind or "").strip() or str((row.payload or {}).get("task_kind") or "").strip()
    executor = task_executor_registry.resolve(task_kind)
    executor.run(task_id)
