import axios, { type AxiosRequestConfig } from "axios";

import { buildApiUrl, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

export type ModelScriptHttpOptions = {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
    responseType?: "json" | "blob" | "text" | "arraybuffer";
};

export type ModelScriptHttp = {
    url: (path: string) => string;
    post: (path: string, body?: unknown, options?: ModelScriptHttpOptions) => Promise<unknown>;
    get: (path: string, options?: ModelScriptHttpOptions) => Promise<unknown>;
};

export type RunModelScriptArgs = {
    capability: ModelCapability;
    script: string;
    config: AiConfig;
    prompt?: string;
    images?: string[];
    messages?: unknown[];
    params?: Record<string, unknown>;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
};

function modelScriptUrl(config: AiConfig, path: string) {
    if (/^https?:/i.test(path)) return path;
    return buildApiUrl(config.baseUrl, path.startsWith("/") ? path : `/${path}`);
}

function createModelScriptHttp(config: AiConfig, options?: RequestOptions): ModelScriptHttp {
    const run = async (method: "get" | "post", path: string, body: unknown, requestOptions?: ModelScriptHttpOptions) => {
        const isForm = typeof FormData !== "undefined" && body instanceof FormData;
        const response = await axios.request({
            method,
            url: modelScriptUrl(config, path),
            data: method === "post" ? body : undefined,
            params: requestOptions?.params,
            headers: {
                ...(method === "post" && body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
                Authorization: `Bearer ${config.apiKey}`,
                ...requestOptions?.headers,
            },
            responseType: requestOptions?.responseType || "json",
            signal: options?.signal,
        });
        return response.data;
    };
    return {
        url: (path) => modelScriptUrl(config, path),
        post: (path, body, requestOptions) => run("post", path, body, requestOptions),
        get: (path, requestOptions) => run("get", path, undefined, requestOptions),
    };
}

function createRawRequest(config: AiConfig, options?: RequestOptions) {
    return async (requestConfig: AxiosRequestConfig & { url: string }) => {
        const response = await axios.request({ ...requestConfig, url: modelScriptUrl(config, requestConfig.url), signal: options?.signal });
        return response.data;
    };
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const finish = () => {
            signal?.removeEventListener("abort", abort);
            resolve();
        };
        const timer = window.setTimeout(finish, ms);
        const abort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}

function createPoll(signal?: AbortSignal) {
    return async function poll<T, R>(request: () => Promise<T>, extract: (value: T) => R | null | undefined | false, options?: { intervalMs?: number; timeoutMs?: number }): Promise<R> {
        const intervalMs = options?.intervalMs ?? 2500;
        const timeoutMs = options?.timeoutMs ?? 300000;
        const deadline = performance.now() + timeoutMs;
        for (;;) {
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            const result = extract(await request());
            if (result !== null && result !== undefined && result !== false) return result;
            if (performance.now() >= deadline) throw new Error("模型调用脚本轮询超时");
            await sleep(intervalMs, signal);
        }
    };
}

export async function runModelScript<T = unknown>(args: RunModelScriptArgs): Promise<T> {
    const http = createModelScriptHttp(args.config, { signal: args.signal });
    const request = createRawRequest(args.config, { signal: args.signal });
    const poll = createPoll(args.signal);
    const runner = new Function(
        "prompt",
        "images",
        "messages",
        "params",
        "model",
        "baseUrl",
        "apiKey",
        "systemPrompt",
        "http",
        "request",
        "poll",
        "sleep",
        "signal",
        "onDelta",
        `"use strict"; return (async () => {\n${args.script}\n})();`,
    ) as (...values: unknown[]) => Promise<T>;
    try {
        return await runner(
            args.prompt || "",
            args.images || [],
            args.messages || [],
            args.params || {},
            args.config.model,
            args.config.baseUrl,
            args.config.apiKey,
            args.config.systemPrompt || "",
            http,
            request,
            poll,
            (ms: number) => sleep(ms, args.signal),
            args.signal,
            args.onDelta,
        );
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (axios.isCancel(error)) throw error;
        throw new Error(`模型调用脚本执行失败：${error instanceof Error ? error.message : String(error)}`);
    }
}

export type ModelScriptVariable = { name: string; type: string; desc: string; capabilities?: ModelCapability[] };

export const MODEL_SCRIPT_VARIABLES: ModelScriptVariable[] = [
    { name: "prompt", type: "string", desc: "本次生成提示词", capabilities: ["image", "video", "audio"] },
    { name: "images", type: "string[]", desc: "参考图 dataURL 数组", capabilities: ["image", "video"] },
    { name: "messages", type: "{ role, content }[]", desc: "文本对话消息数组", capabilities: ["text"] },
    { name: "params", type: "object", desc: "当前媒体类型的尺寸、数量、蒙版、时长、音色等参数" },
    { name: "model", type: "string", desc: "当前请求模型名，不含渠道前缀" },
    { name: "baseUrl", type: "string", desc: "当前渠道 Base URL" },
    { name: "apiKey", type: "string", desc: "当前渠道 API Key" },
    { name: "systemPrompt", type: "string", desc: "系统提示词" },
    { name: "http", type: "object", desc: "自动携带 Bearer 鉴权的 get/post/url 请求助手" },
    { name: "request", type: "function", desc: "完全由脚本控制 headers、body 和 responseType 的原始请求" },
    { name: "poll", type: "function", desc: "异步任务轮询助手 poll(request, extract, options)" },
    { name: "sleep", type: "function", desc: "支持取消信号的 sleep(ms)" },
    { name: "signal", type: "AbortSignal", desc: "当前生成任务的取消信号" },
    { name: "onDelta", type: "function", desc: "推送流式文本片段", capabilities: ["text"] },
];

export const MODEL_SCRIPT_RETURNS: Record<ModelCapability, string> = {
    image: "返回图片 URL/dataURL、它们的数组，或包含 dataUrl、url、b64_json 的对象数组。",
    video: "脚本内部完成提交和轮询，返回视频 URL、{ url } 或 { blob }。",
    audio: "返回 Blob、URL、base64/dataURL，或包含 b64_json、data、url 的对象。",
    text: "使用 onDelta(text) 推送流式片段，并 return 最终完整文本。",
};

export type ModelScriptTemplate = { label: string; script: string };

export const MODEL_SCRIPT_TEMPLATES: Record<ModelCapability, ModelScriptTemplate[]> = {
    image: [
        {
            label: "OpenAI 规范",
            script: `// 文生图与图生图使用不同接口；images 为空时生成，否则编辑。
if (images.length === 0) {
  const data = await http.post("/images/generations", {
    model, prompt, n: params.count, size: params.size, response_format: "b64_json",
  });
  return (data.data || []).map((item) => item.b64_json
    ? \`data:image/png;base64,\${item.b64_json}\`
    : item.url);
}

const form = new FormData();
form.set("model", model);
form.set("prompt", prompt);
form.set("n", String(params.count));
form.set("response_format", "b64_json");
for (const dataUrl of images) {
  form.append("image", await (await fetch(dataUrl)).blob(), "ref.png");
}
if (params.mask) {
  form.set("mask", await (await fetch(params.mask)).blob(), "mask.png");
}
const edited = await http.post("/images/edits", form);
return (edited.data || []).map((item) => item.b64_json
  ? \`data:image/png;base64,\${item.b64_json}\`
  : item.url);`,
        },
        {
            label: "Gemini 规范",
            script: `const parts = [{ text: prompt }];
for (const dataUrl of images) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
}
const data = await request({
  method: "post",
  url: \`\${baseUrl.replace(/\\\/$/, "")}/v1beta/models/\${model}:generateContent\`,
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"] } },
});
return (data.candidates || [])
  .flatMap((candidate) => candidate.content?.parts || [])
  .map((part) => part.inlineData || part.inline_data)
  .filter(Boolean)
  .map((image) => \`data:\${image.mimeType || image.mime_type || "image/png"};base64,\${image.data}\`);`,
        },
    ],
    video: [
        {
            label: "OpenAI 规范",
            script: `const task = await http.post("/videos", {
  model, prompt, seconds: params.seconds,
});
return await poll(
  () => http.get(\`/videos/\${task.id}\`),
  (state) => state.status === "completed" ? { url: state.video_url || state.url } : null,
  { intervalMs: 2500, timeoutMs: 300000 },
);`,
        },
        {
            label: "Gemini 规范",
            script: `const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey };
const instance = { prompt };
const first = images[0] && images[0].match(/^data:([^;]+);base64,(.*)$/);
if (first) instance.image = { bytesBase64Encoded: first[2], mimeType: first[1] };
const root = baseUrl.replace(/\\\/$/, "");
const operation = await request({
  method: "post",
  url: \`\${root}/v1beta/models/\${model}:predictLongRunning\`,
  headers,
  data: { instances: [instance], parameters: { aspectRatio: params.ratio } },
});
return await poll(
  () => request({ method: "get", url: \`\${root}/v1beta/\${operation.name}\`, headers }),
  (state) => {
    if (!state.done) return null;
    const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error("Gemini 未返回视频 URI");
    return { url: uri.includes("key=") ? uri : \`\${uri}\${uri.includes("?") ? "&" : "?"}key=\${apiKey}\` };
  },
  { intervalMs: 5000, timeoutMs: 300000 },
);`,
        },
    ],
    audio: [
        {
            label: "OpenAI 规范",
            script: `return await http.post("/audio/speech", {
  model,
  input: prompt,
  voice: params.voice,
  response_format: params.format,
  speed: Number(params.speed),
}, { responseType: "blob" });`,
        },
        {
            label: "Gemini 规范",
            script: `const data = await request({
  method: "post",
  url: \`\${baseUrl.replace(/\\\/$/, "")}/v1beta/models/\${model}:generateContent\`,
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: params.voice } } },
    },
  },
});
const audio = data.candidates?.[0]?.content?.parts
  ?.map((part) => part.inlineData || part.inline_data)
  .find(Boolean);
if (!audio?.data) throw new Error("Gemini 未返回音频");
return { data: audio.data };`,
        },
    ],
    text: [
        {
            label: "OpenAI 规范",
            script: `const data = await http.post("/responses", { model, input: messages });
const text = data.output_text
  || (data.output || []).flatMap((item) => item.content || []).map((item) => item.text || "").join("")
  || "";
onDelta(text);
return text;`,
        },
        {
            label: "Gemini 规范",
            script: `const contents = messages
  .filter((message) => message.role !== "system")
  .map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
const data = await request({
  method: "post",
  url: \`\${baseUrl.replace(/\\\/$/, "")}/v1beta/models/\${model}:generateContent\`,
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: { contents, ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}) },
});
const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
onDelta(text);
return text;`,
        },
    ],
};

export function normalizeModelScriptImages(result: unknown): string[] {
    const items = Array.isArray(result) ? result : [result];
    const images = items
        .map((item) => {
            if (typeof item === "string") return item;
            if (!item || typeof item !== "object") return "";
            const record = item as Record<string, unknown>;
            if (typeof record.dataUrl === "string") return record.dataUrl;
            if (typeof record.url === "string") return record.url;
            if (typeof record.b64_json === "string") return `data:image/png;base64,${record.b64_json}`;
            return "";
        })
        .filter(Boolean);
    if (!images.length) throw new Error("模型调用脚本没有返回图片");
    return images;
}
