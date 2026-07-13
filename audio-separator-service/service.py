from __future__ import annotations

import json
import logging
import os
import queue
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


HOST = "127.0.0.1"
PORT = 17372
MODEL = os.environ.get("AUDIO_SEPARATOR_MODEL", "model_bs_roformer_ep_317_sdr_12.9755.ckpt")
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
ROOT = Path(__file__).resolve().parent
WORK_DIR = ROOT / "work"
MODEL_DIR = ROOT / "models"
RUNTIME_DIR = ROOT / ".runtime"
LOG_DIR = ROOT / "logs"
SEPARATOR_EXE = ROOT / ".venv" / "Scripts" / "audio-separator.exe"
FFMPEG_EXE = RUNTIME_DIR / "ffmpeg.exe"

for directory in (WORK_DIR, MODEL_DIR, LOG_DIR):
    directory.mkdir(parents=True, exist_ok=True)
for stale_job_dir in WORK_DIR.iterdir():
    if stale_job_dir.is_dir():
        shutil.rmtree(stale_job_dir, ignore_errors=True)

logging.basicConfig(
    filename=LOG_DIR / "service.log",
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    encoding="utf-8",
)


@dataclass
class Job:
    id: str
    status: str = "queued"
    progress: int = 5
    text: str = "等待本地 GPU"
    error: str | None = None
    vocals: str | None = None
    instrumental: str | None = None
    created_at: float = 0


jobs: dict[str, Job] = {}
jobs_lock = threading.Lock()
job_queue: queue.Queue[str] = queue.Queue()


def update_job(job_id: str, **changes: object) -> None:
    with jobs_lock:
        job = jobs[job_id]
        for key, value in changes.items():
            setattr(job, key, value)


def find_stems(output_dir: Path) -> tuple[Path, Path]:
    files = list(output_dir.glob("*.wav")) + list(output_dir.glob("*.flac")) + list(output_dir.glob("*.mp3"))
    vocals = next((path for path in files if "vocal" in path.name.lower()), None)
    instrumental = next((path for path in files if any(value in path.name.lower() for value in ("instrument", "no_vocal", "karaoke"))), None)
    if not vocals or not instrumental:
        raise RuntimeError("分离任务完成，但没有找到人声和背景音乐文件")
    return vocals, instrumental


def run_job(job_id: str) -> None:
    job_dir = WORK_DIR / job_id
    source = next(job_dir.glob("source.*"))
    audio_path = job_dir / "source.wav"
    output_dir = job_dir / "output"
    output_dir.mkdir(exist_ok=True)

    update_job(job_id, status="processing", progress=12, text="正在从视频提取音轨")
    extracted = subprocess.run(
        [str(FFMPEG_EXE), "-y", "-i", str(source), "-vn", "-ac", "2", "-ar", "44100", str(audio_path)],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if extracted.returncode != 0:
        raise RuntimeError("视频中没有可分离的音轨，或当前视频格式无法读取")

    update_job(job_id, progress=24, text="正在加载 BS-Roformer 模型，首次使用会自动下载")
    command = [
        str(SEPARATOR_EXE),
        str(audio_path),
        "--model_filename",
        MODEL,
        "--model_file_dir",
        str(MODEL_DIR),
        "--output_dir",
        str(output_dir),
        "--output_format",
        "WAV",
    ]
    separator_env = os.environ.copy()
    separator_env["PATH"] = f"{RUNTIME_DIR}{os.pathsep}{separator_env.get('PATH', '')}"
    separator_env["PYTHONUTF8"] = "1"
    separator_env["PYTHONIOENCODING"] = "utf-8"
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=separator_env,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    assert process.stdout is not None
    for line in process.stdout:
        logging.info("separator[%s] %s", job_id, line.rstrip())
        value = line.lower()
        if "download" in value:
            update_job(job_id, progress=30, text="正在下载 BS-Roformer 模型")
        elif "separat" in value or "inference" in value:
            update_job(job_id, progress=58, text="正在使用 GPU 分离人声与背景音乐")
        elif "writing" in value or "export" in value or "saving" in value:
            update_job(job_id, progress=86, text="正在导出两条音轨")
    if process.wait() != 0:
        raise RuntimeError("BS-Roformer 分离失败，请查看 audio-separator-service/logs/service.log")

    vocals, instrumental = find_stems(output_dir)
    update_job(
        job_id,
        status="completed",
        progress=100,
        text="分离完成",
        vocals=str(vocals),
        instrumental=str(instrumental),
    )


def worker() -> None:
    while True:
        job_id = job_queue.get()
        try:
            run_job(job_id)
        except Exception as error:
            logging.exception("Audio separation failed for %s", job_id)
            detail = str(error).strip() or error.__class__.__name__
            update_job(job_id, status="failed", text="分离失败", error=detail)
        finally:
            job_queue.task_done()


class Handler(BaseHTTPRequestHandler):
    server_version = "InfiniteCanvasAudioSeparator/1.0"

    def log_message(self, format: str, *args: object) -> None:
        logging.info("http %s", format % args)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json({"status": "ok", "model": MODEL, "queueSize": job_queue.qsize()})
            return
        parts = path.strip("/").split("/")
        if len(parts) == 2 and parts[0] == "jobs":
            self.send_job(parts[1])
            return
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] in {"vocals", "instrumental"}:
            self.send_stem(parts[1], parts[2])
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/jobs":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_UPLOAD_BYTES:
            self.send_json({"error": "视频文件为空或超过 2GB"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return
        extension = Path(self.headers.get("X-Filename", "video.mp4")).suffix.lower()
        if extension not in {".mp4", ".mov", ".webm", ".mkv", ".avi"}:
            extension = ".mp4"
        job_id = uuid.uuid4().hex
        job_dir = WORK_DIR / job_id
        job_dir.mkdir(parents=True)
        source = job_dir / f"source{extension}"
        remaining = length
        with source.open("wb") as target:
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                target.write(chunk)
                remaining -= len(chunk)
        if remaining:
            shutil.rmtree(job_dir, ignore_errors=True)
            self.send_json({"error": "视频上传不完整"}, HTTPStatus.BAD_REQUEST)
            return
        with jobs_lock:
            jobs[job_id] = Job(id=job_id, created_at=time.time())
        job_queue.put(job_id)
        self.send_json({"id": job_id}, HTTPStatus.ACCEPTED)

    def do_DELETE(self) -> None:
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) != 2 or parts[0] != "jobs":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        with jobs_lock:
            job = jobs.get(parts[1])
            if job and job.status in {"queued", "processing"}:
                self.send_json({"error": "任务仍在运行"}, HTTPStatus.CONFLICT)
                return
            jobs.pop(parts[1], None)
        shutil.rmtree(WORK_DIR / parts[1], ignore_errors=True)
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def send_job(self, job_id: str) -> None:
        with jobs_lock:
            job = jobs.get(job_id)
            payload = asdict(job) if job else None
        if not payload:
            self.send_json({"error": "任务不存在"}, HTTPStatus.NOT_FOUND)
            return
        payload.pop("vocals", None)
        payload.pop("instrumental", None)
        self.send_json(payload)

    def send_stem(self, job_id: str, stem: str) -> None:
        with jobs_lock:
            job = jobs.get(job_id)
            filename = getattr(job, stem, None) if job else None
        if not filename or not Path(filename).is_file():
            self.send_json({"error": "音轨尚未生成"}, HTTPStatus.NOT_FOUND)
            return
        path = Path(filename)
        size = path.stat().st_size
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Disposition", f'attachment; filename="{stem}.wav"')
        self.end_headers()
        with path.open("rb") as source:
            shutil.copyfileobj(source, self.wfile)

    def send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


threading.Thread(target=worker, daemon=True, name="audio-separator-worker").start()
logging.info("Starting local audio separator on http://%s:%s with %s", HOST, PORT, MODEL)
ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
