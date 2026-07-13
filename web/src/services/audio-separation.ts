import axios from "axios";

const serviceUrl = "http://127.0.0.1:17372";

type SeparationJob = {
    id: string;
    status: "queued" | "processing" | "completed" | "failed";
    progress: number;
    text: string;
    error?: string;
};

export type AudioSeparationProgress = { percent: number; text: string };
export type AudioSeparationResult = { vocals: Blob; instrumental: Blob };

export async function separateVideoAudio(video: Blob, filename: string, onProgress?: (progress: AudioSeparationProgress) => void, signal?: AbortSignal): Promise<AudioSeparationResult> {
    await assertServiceReady(signal);
    onProgress?.({ percent: 2, text: "正在上传视频到本地分离助手" });
    let jobId = "";
    try {
        const created = await axios.post<{ id: string }>(`${serviceUrl}/jobs`, video, {
            headers: { "Content-Type": video.type || "video/mp4", "X-Filename": filename },
            signal,
            onUploadProgress: (event) => {
                if (!event.total) return;
                onProgress?.({ percent: Math.max(2, Math.round((event.loaded / event.total) * 10)), text: "正在上传视频到本地分离助手" });
            },
        });
        jobId = created.data.id;
        while (true) {
            await wait(1200, signal);
            const { data: job } = await axios.get<SeparationJob>(`${serviceUrl}/jobs/${jobId}`, { signal });
            onProgress?.({ percent: 10 + Math.round(job.progress * 0.8), text: job.text });
            if (job.status === "failed") throw new Error(job.error || "本地音频分离失败");
            if (job.status === "completed") break;
        }
        onProgress?.({ percent: 94, text: "正在保存人声和背景音乐" });
        const [vocals, instrumental] = await Promise.all([
            axios.get<Blob>(`${serviceUrl}/jobs/${jobId}/vocals`, { responseType: "blob", signal }).then((response) => response.data),
            axios.get<Blob>(`${serviceUrl}/jobs/${jobId}/instrumental`, { responseType: "blob", signal }).then((response) => response.data),
        ]);
        return { vocals, instrumental };
    } catch (error) {
        if (axios.isAxiosError(error) && (!error.response || error.code === "ERR_NETWORK")) throw serviceUnavailableError();
        throw error;
    } finally {
        if (jobId) void axios.delete(`${serviceUrl}/jobs/${jobId}`).catch(() => undefined);
    }
}

async function assertServiceReady(signal?: AbortSignal) {
    try {
        await axios.get(`${serviceUrl}/health`, { timeout: 2500, signal });
    } catch {
        throw serviceUnavailableError();
    }
}

function serviceUnavailableError() {
    return new Error("本地音频分离助手尚未就绪。请保持 start-web.bat 运行；首次安装 CUDA 运行环境需要一些时间，可在 audio-separator-service/logs 查看进度。");
}

function wait(duration: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, duration);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(new DOMException("任务已取消", "AbortError"));
            },
            { once: true },
        );
    });
}
