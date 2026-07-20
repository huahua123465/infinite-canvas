type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel { name: string; modelName: string; type: "text"; think: boolean; }
interface ImageModel { name: string; modelName: string; type: "image"; mode: ("text" | "singleImage" | "multiReference")[]; }
interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}
interface VendorConfig {
  id: string;
  version: string;
  author: string;
  name: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel)[];
}
type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string };
interface ImageConfig { prompt: string; referenceList?: Extract<ReferenceList, { type: "image" }>[]; size: "1K" | "2K" | "4K"; aspectRatio: `${number}:${number}`; }
interface VideoConfig { duration: number; resolution: string; prompt: string; referenceList?: ReferenceList[]; audio?: boolean; mode: VideoMode[]; aspectRatio: "16:9" | "9:16"; }
interface TTSConfig { text: string; voice: string; speechRate: number; pitchRate: number; volume: number; }
interface PollResult { completed: boolean; data?: string; error?: string; }

declare const axios: any;
declare const FormData: any;
declare const Buffer: any;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const createOpenAI: any;
declare const exports: any;

const vendor: VendorConfig = {
  id: "cangyuan-v3",
  version: "2.2",
  author: "Infinite Canvas",
  name: "沧元算力 API（v2）",
  description: "沧元算力文本、图片和视频 API 适配器。",
  inputs: [
    { key: "textApiKey", label: "Text API Key", type: "password", required: true },
    { key: "imageApiKey", label: "Image API Key", type: "password", required: true },
    { key: "videoApiKey", label: "Video API Key", type: "password", required: true },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "https://ai.cangyuansuanli.cn/v1" },
  ],
  inputValues: { textApiKey: "", imageApiKey: "", videoApiKey: "", baseUrl: "https://ai.cangyuansuanli.cn/v1" },
  models: [
    { name: "GPT-5.5", modelName: "gpt-5.5", type: "text", think: false },
    { name: "DeepSeek V4 Pro", modelName: "deepseek-v4-pro", type: "text", think: false },
    { name: "Claude Sonnet 4.6", modelName: "claude-sonnet-4-6", type: "text", think: false },
    { name: "Nano Banana Pro 1K", modelName: "nano-banana-pro-1k", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "Nano Banana 2 2K", modelName: "nano-banana2-2k", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "GPT Image 2 2K", modelName: "gpt-image-2-2k", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "Seedance 2.0", modelName: "seedance-2.0", type: "video", mode: ["text", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]], audio: "optional", durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] }] },
    { name: "Seedance 2.0 Fast", modelName: "seedance-2.0-fast", type: "video", mode: ["text", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]], audio: "optional", durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] }] },
    { name: "Omni Fast", modelName: "omni-fast", type: "video", mode: ["text", "singleImage", "startEndRequired"], audio: false, durationResolutionMap: [{ duration: [10], resolution: ["720p"] }] },
    { name: "Sora 2", modelName: "sora-2", type: "video", mode: ["text", "singleImage"], audio: "optional", durationResolutionMap: [{ duration: [4, 8, 12], resolution: ["720p"] }] },
  ],
};

function apiKey(kind: "text" | "image" | "video") {
  const key = vendor.inputValues[`${kind}ApiKey`]?.trim();
  if (!key) throw new Error(`Please enter the ${kind} Cangyuan API Key`);
  return key.replace(/^Bearer\s+/i, "");
}

function baseUrl() { return vendor.inputValues.baseUrl.replace(/\/+$/, ""); }
function headers(kind: "text" | "image" | "video", json = false) { return { Authorization: `Bearer ${apiKey(kind)}`, ...(json ? { "Content-Type": "application/json" } : {}) }; }
function errorMessage(response: any, fallback: string) { return response?.data?.error?.message || response?.data?.msg || response?.data?.message || `${fallback}（HTTP ${response?.status || "?"}）`; }
function valueUrl(value: any) { return typeof value === "string" ? value : value?.url || value?.video_url || value?.result_url || ""; }
function imageResult(data: any) {
  const items = Array.isArray(data?.data) ? data.data : data?.data ? [data.data] : [];
  const urls = [data?.url, data?.result_url, ...(data?.result_urls || []), ...items.map((item: any) => valueUrl(item))].filter(Boolean);
  return urls[0] || "";
}
function taskId(data: any) { return data?.id || data?.task_id || data?.data?.id || data?.data?.task_id || ""; }
function resolution(value: string, model: string) {
  const fixed = model.match(/-(1k|2k|4k)$/i)?.[1];
  return (fixed || value || "1K").toUpperCase();
}
function mediaUrl(item: ReferenceList) { return item.base64; }

const textRequest = (model: TextModel) => {
  return createOpenAI({ baseURL: baseUrl(), apiKey: apiKey("text") }).chat(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const refs = (config.referenceList || []).filter((item) => item.base64);
  const ratio = config.aspectRatio || "16:9";
  if (refs.length) {
    const form = new FormData();
    form.append("model", model.modelName);
    form.append("prompt", config.prompt);
    form.append("aspect_ratio", ratio);
    form.append("image_size", resolution(config.size, model.modelName));
    for (const ref of refs.slice(0, 9)) {
      const match = ref.base64.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error("参考图必须是 Base64 图片");
      form.append("image", Buffer.from(match[2], "base64"), { filename: "reference.png", contentType: match[1] });
    }
    try {
      const response = await axios.post(`${baseUrl()}/images/edits`, form, { headers: { ...headers("image"), ...form.getHeaders() } });
      const url = imageResult(response.data);
      if (url) return await urlToBase64(url);
      throw new Error("沧元图生图没有返回图片地址");
    } catch (error) { throw new Error(errorMessage(error?.response, "沧元图生图失败")); }
  }
  try {
    const response = await axios.post(`${baseUrl()}/images/generations`, { model: model.modelName, prompt: config.prompt, aspect_ratio: ratio, image_size: resolution(config.size, model.modelName) }, { headers: headers("image", true) });
    const url = imageResult(response.data);
    if (url) return await urlToBase64(url);
    const id = taskId(response.data);
    if (!id) throw new Error("沧元生图没有返回图片或任务 ID");
    const result = await pollTask(async () => {
      const status = await axios.get(`${baseUrl()}/images/generations/${encodeURIComponent(id)}`, { headers: headers("image") });
      const url = imageResult(status.data);
      if (url) return { completed: true, data: url };
      const state = String(status.data?.status || status.data?.data?.status || "").toLowerCase();
      if (["failed", "error", "cancelled"].includes(state)) return { completed: true, error: errorMessage(status, "沧元生图失败") };
      return { completed: false };
    }, 5000, 600000);
    if (result.error) throw new Error(result.error);
    return await urlToBase64(result.data!);
  } catch (error) { throw new Error(errorMessage(error?.response, "沧元文生图失败")); }
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const refs = config.referenceList || [];
  const images = refs.filter((item) => item.type === "image");
  const videos = refs.filter((item) => item.type === "video");
  const audios = refs.filter((item) => item.type === "audio");
  const body: Record<string, any> = { model: model.modelName, prompt: config.prompt, aspect_ratio: config.aspectRatio || "16:9", duration: Math.max(4, Math.min(15, Number(config.duration) || 5)) };
  if (model.modelName.startsWith("omni-")) {
    delete body.duration;
    if (images.length) body.image_url = mediaUrl(images[0]);
  } else if (model.modelName.startsWith("sora-")) {
    body.duration = [4, 8, 12].includes(Number(config.duration)) ? Number(config.duration) : 8;
    body.generate_audio = config.audio !== false;
    if (images[0]) {
      body.reference_mode = "frame";
      body.images = [mediaUrl(images[0])];
    }
  } else if (config.mode === "startEndRequired" || config.mode === "endFrameOptional" || config.mode === "startFrameOptional") {
    if (images[0]) body.first_image_url = mediaUrl(images[0]);
    if (images[1]) body.last_image_url = mediaUrl(images[1]);
  } else {
    if (images[0]) body.image_url = mediaUrl(images[0]);
    if (images.length > 1) body.reference_image_urls = images.slice(1, 9).map(mediaUrl);
    if (videos.length) body.reference_videos = videos.slice(0, 3).map(mediaUrl);
    if (audios.length) body.reference_audios = audios.slice(0, 3).map(mediaUrl);
  }
  if (model.modelName.startsWith("seedance-2.0") && !/-\d{3,4}p$|-4k$/i.test(model.modelName)) {
    body.resolution = String(config.resolution || "720p").toLowerCase();
    body.audio = config.audio !== false;
  }
  try {
    const response = await axios.post(`${baseUrl()}/videos`, body, { headers: headers("video", true) });
    const id = taskId(response.data);
    if (!id) { const direct = valueUrl(response.data); if (direct) return await urlToBase64(direct); throw new Error("沧元视频没有返回任务 ID"); }
    const result = await pollTask(async () => {
      const status = await axios.get(`${baseUrl()}/videos/${encodeURIComponent(id)}`, { headers: headers("video") });
      const url = valueUrl(status.data?.video_url || status.data?.data?.video_url || status.data?.url || status.data?.data?.url);
      const state = String(status.data?.status || status.data?.data?.status || "").toLowerCase();
      if (["completed", "complete", "success", "succeeded", "done"].includes(state)) {
        if (url) return { completed: true, data: url };
        return { completed: true, data: `${baseUrl()}/videos/${encodeURIComponent(id)}/content` };
      }
      if (["failed", "error", "cancelled", "expired"].includes(state)) return { completed: true, error: errorMessage(status, "沧元视频生成失败") };
      return { completed: false };
    }, 5000, 1800000);
    if (result.error) throw new Error(result.error);
    return await urlToBase64(result.data!);
  } catch (error) { throw new Error(errorMessage(error?.response, "沧元视频生成失败")); }
};

const ttsRequest = async (_config: TTSConfig): Promise<string> => { throw new Error("沧元供应商暂未配置语音模型"); };

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = async () => ({ hasUpdate: false, latestVersion: "2.2", notice: "" });
exports.updateVendor = async () => "";
export {};
