import argparse
import base64
import binascii
import io
import os
import re
import tempfile
import threading
import traceback
from pathlib import Path

import soundfile as sf
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from voxcpm import VoxCPM


MODEL_ID = os.environ.get("VOXCPM_MODEL_ID", "openbmb/VoxCPM2")
DEVICE = os.environ.get("VOXCPM_DEVICE", "cuda")
RUNTIME_DIR = Path(os.environ.get("VOXCPM_RUNTIME_DIR", Path(__file__).parent / ".runtime")).resolve()
TEMP_DIR = RUNTIME_DIR / "temp"
OUTPUT_DIR = RUNTIME_DIR / "outputs"
MAX_REFERENCE_BYTES = 30 * 1024 * 1024
model = None
model_lock = threading.Lock()
TEMP_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class SpeechRequest(BaseModel):
    model: str = "VoxCPM2"
    input: str = Field(min_length=1)
    voice: str = "default"
    response_format: str = "wav"
    speed: float = Field(default=1, ge=0.25, le=4)
    instructions: str = ""
    reference_audio: str | None = None
    prompt_text: str | None = None
    cfg_value: float = Field(default=2, ge=1, le=3)
    inference_timesteps: int = Field(default=10, ge=1, le=50)
    seed: int | None = None


app = FastAPI(title="Infinite Canvas VoxCPM Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def get_model():
    global model
    if model is None:
        model = VoxCPM.from_pretrained(MODEL_ID, device=DEVICE, optimize=DEVICE.startswith("cuda"), load_denoiser=False)
    return model


def create_reference_file(value: str | None):
    if not value:
        return None
    match = re.fullmatch(r"data:audio/([^;]+);base64,(.+)", value, re.DOTALL | re.IGNORECASE)
    if not match:
        raise ValueError("reference_audio must be an audio data URL")
    audio_type = match.group(1).lower()
    data = base64.b64decode(match.group(2), validate=True)
    if not data or len(data) > MAX_REFERENCE_BYTES:
        raise ValueError("reference_audio must be between 1 byte and 30 MB")
    suffix = {"mpeg": ".mp3", "mp3": ".mp3", "wav": ".wav", "x-wav": ".wav", "ogg": ".ogg", "mp4": ".m4a", "aac": ".aac", "webm": ".webm"}.get(audio_type, ".audio")
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=TEMP_DIR)
    try:
        handle.write(data)
        return Path(handle.name)
    finally:
        handle.close()


def build_text(request: SpeechRequest):
    control = re.sub(r"[()（）]", "", request.instructions).strip()
    if request.speed != 1:
        control = "，".join(filter(None, [control, f"语速约为正常语速的 {request.speed:g} 倍"]))
    text = request.input.strip()
    return f"({control}){text}" if control else text


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "device": DEVICE, "loaded": model is not None, "runtime_dir": str(RUNTIME_DIR), "hf_hub_cache": os.environ.get("HF_HUB_CACHE", "")}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "VoxCPM2", "object": "model", "owned_by": "openbmb"}]}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    reference_path = None
    try:
        reference_path = create_reference_file(request.reference_audio)
        with model_lock:
            current_model = get_model()
            kwargs = {
                "text": build_text(request),
                "cfg_value": request.cfg_value,
                "inference_timesteps": request.inference_timesteps,
                "seed": request.seed,
            }
            if reference_path:
                kwargs["reference_wav_path"] = str(reference_path)
            if reference_path and request.prompt_text:
                kwargs.update(prompt_wav_path=str(reference_path), prompt_text=request.prompt_text.strip())
            audio = current_model.generate(**kwargs)
            output = io.BytesIO()
            sf.write(output, audio, current_model.tts_model.sample_rate, format="WAV")
        return Response(output.getvalue(), media_type="audio/wav", headers={"Content-Disposition": "inline; filename=voxcpm.wav"})
    except (ValueError, binascii.Error) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(error)) from error
    finally:
        if reference_path:
            reference_path.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8810)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)
