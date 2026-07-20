import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";

import { DEFAULT_PORT, ensureSiteWorkspace, loadConfig, saveConfig, updateSiteWorkspace, type CanvasAgentConfig } from "./config.js";
import { CanvasSession } from "./canvas-session.js";
import { archiveCodexThread, interruptCodexTurn, isRecoverableThreadError, listCodexThreads, readCodexThread, resumeCodexThread, runClaudeTurn, runCodexTurn, startCodexThread, summarizeCodexThread, verifyCodexThreadWorkspace, withAgentPrompt } from "./agents.js";
import type { AgentAttachment } from "./types.js";

export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const session = new CanvasSession();
    const emit = (type: string, payload: unknown) => {
        const data = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : { value: payload };
        const threadId = String(data.threadId || data.thread_id || ensureSiteWorkspace(config).activeThreadId || "");
        threadId ? session.emitThread(type, threadId, data) : session.emitAll(type, data);
    };
    const setActiveThread = (activeThreadId: string, payload: Record<string, unknown> = {}) => {
        const workspace = updateSiteWorkspace(config, { activeThreadId: activeThreadId || undefined });
        session.emitThread("workspace_changed", activeThreadId, { ...payload, activeThreadId });
        return workspace;
    };
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "30mb" }));
    app.use((req, res, next) => {
        const url = requestUrl(req, config);
        if (!setCors(req, res, url, config)) return void res.status(403).json({ ok: false, error: "origin not allowed" });
        if (req.method === "OPTIONS") return void res.json({});
        next();
    });
    app.get("/health", (_req, res) => res.json(session.health()));
    app.get("/config", (_req, res) => res.json({ ok: true, url: config.url, hasToken: true }));
    app.use((req, res, next) => {
        if (validToken(req, requestUrl(req, config), config.token)) return next();
        res.status(401).json({ ok: false, error: "invalid token" });
    });
    app.get("/events", (req, res) => session.openEvents(requestUrl(req, config), res));
    app.post("/canvas/state", (req, res) => {
        session.updateState(req.body, String(req.query.clientId || "") || undefined);
        res.json({ ok: true });
    });
    app.post("/canvas/activate", (req, res) => {
        session.activateClient(String(req.query.clientId || ""));
        res.json({ ok: true });
    });
    app.post("/canvas/result", (req, res) => {
        const ok = session.resolveResult(String(req.query.clientId || ""), req.body);
        res.status(ok ? 200 : 409).json({ ok });
    });
    app.get("/agent/attachments/:attachmentId", route(async (req, res) => {
        const attachment = session.getTurnAttachment(String(req.query.clientId || ""), routeParam(req.params.attachmentId));
        const data = attachment.dataUrl.split(",", 2)[1];
        if (!data) throw new Error("图片附件内容无效");
        res.setHeader("Cache-Control", "no-store");
        res.type(attachment.type).send(Buffer.from(data, "base64"));
    }));
    app.post("/api/tools", route(async (req, res) => res.json({ ok: true, result: await session.callTool(req.body?.name, req.body?.input || {}) })));
    app.get("/api/skills/seedance-20/context", route(async (_req, res) => res.json({ ok: true, ...(await loadSeedance20Context()) })));
    app.get("/api/skills/screenwriting/context", route(async (_req, res) => res.json({ ok: true, ...(await loadScreenwritingContext()) })));
    app.post("/api/proxy/media/download", route(proxyMediaDownload));
    app.post("/api/proxy/volcengine/tts", route(proxyVolcengineSpeech));
    app.post("/api/proxy/volcengine/voice-clone", route((req, res) => proxyVolcengineJson(req, res, "/api/v3/tts/voice_clone")));
    app.post("/api/proxy/volcengine/get-voice", route((req, res) => proxyVolcengineJson(req, res, "/api/v3/tts/get_voice")));
    app.post("/api/proxy/voicebox", route(proxyVoicebox));
    app.get("/agent/codex/workspace", (_req, res) => {
        const workspace = ensureSiteWorkspace(config);
        res.json({ ok: true, workspace });
    });
    app.get("/agent/codex/threads", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const result = await listCodexThreads(emit, { cwd: workspace.workspacePath, searchTerm: String(req.query.searchTerm || "") });
        res.json({ ok: true, workspace, ...result });
    }));
    app.post("/agent/codex/threads/new", route(async (_req, res) => {
        if (session.codexBusy) return res.status(409).json({ ok: false, error: "Codex 正在运行，请等待当前任务完成" });
        const workspace = ensureSiteWorkspace(config);
        const thread = await startCodexThread(emit, workspace.workspacePath);
        const activeThreadId = String((thread as Record<string, unknown>).id || "");
        const nextWorkspace = setActiveThread(activeThreadId, { emptyThread: true });
        res.json({ ok: true, workspace: nextWorkspace, thread: summarizeCodexThread(thread), messages: [] });
    }));
    app.get("/agent/codex/threads/:threadId", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        try {
            res.json({ ok: true, workspace, ...(await readCodexThread(emit, threadId, workspace.workspacePath)) });
        } catch (error) {
            if (workspace.activeThreadId !== threadId || !isRecoverableThreadError(error)) throw error;
            res.json({ ok: true, workspace, thread: { id: threadId, preview: "", cwd: workspace.workspacePath }, messages: [] });
        }
    }));
    app.post("/agent/codex/threads/:threadId/resume", route(async (req, res) => {
        if (session.codexBusy) return res.status(409).json({ ok: false, error: "Codex 正在运行，请等待当前任务完成" });
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        const result = await resumeCodexThread(emit, threadId, workspace.workspacePath);
        const nextWorkspace = setActiveThread(threadId);
        res.json({ ok: true, workspace: nextWorkspace, ...result });
    }));
    app.post("/agent/codex/threads/:threadId/delete", route(async (req, res) => {
        if (session.codexBusy) return res.status(409).json({ ok: false, error: "Codex 正在运行，请等待当前任务完成" });
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        await archiveCodexThread(emit, threadId, workspace.workspacePath);
        setActiveThread(workspace.activeThreadId === threadId ? "" : workspace.activeThreadId || "");
        res.json({ ok: true });
    }));
    app.post("/agent/codex/turn", route(async (req, res) => {
        if (session.codexBusy) return res.status(409).json({ ok: false, error: "Codex 正在运行，请等待当前任务完成" });
        const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as AgentAttachment[]) : [];
        const workspace = ensureSiteWorkspace(config);
        const prompt = String(req.body?.prompt || "");
        if (!prompt.trim()) return res.status(400).json({ ok: false, error: "请输入任务内容" });
        const clientId = String(req.body?.clientId || "");
        session.setCodexState({ busy: true, threadId: String(req.body?.threadId || workspace.activeThreadId || ""), turnId: "" });
        try {
            let threadId = String(req.body?.threadId || workspace.activeThreadId || "");
            let turnId = "";
            if (!threadId) {
                const thread = await startCodexThread(emit, workspace.workspacePath);
                threadId = String((thread as Record<string, unknown>).id || "");
                setActiveThread(threadId, { emptyThread: true });
            } else if (threadId !== workspace.activeThreadId) {
                await verifyCodexThreadWorkspace(emit, threadId, workspace.workspacePath);
                setActiveThread(threadId);
            }
            const attachmentRefs = session.setTurnAttachments(clientId, attachments);
            const chatMessage = {
                sourceClientId: clientId,
                message: { id: String(req.body?.messageId || Date.now()), role: "user", text: String(req.body?.messageText || prompt || `发送了 ${attachments.length} 张图片`) },
            };
            let chatThreadId = "";
            const turnEmit = (type: string, payload: unknown) => {
                const data = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : { value: payload };
                session.emitThread(type, threadId, data);
            };
            void runCodexTurn(withAgentPrompt(withAttachmentContext(prompt, attachmentRefs)), turnEmit, attachments, {
                threadId,
                cwd: workspace.workspacePath,
                appEmit: emit,
                onStart: clientId ? () => session.bindClient(clientId) : undefined,
                onThread: (actualThreadId) => {
                    if (actualThreadId !== threadId) {
                        threadId = actualThreadId;
                        setActiveThread(threadId, { emptyThread: true });
                    }
                    session.setCodexState({ busy: true, threadId, turnId: "" });
                    if (chatThreadId !== threadId) {
                        chatThreadId = threadId;
                        session.emitThread("chat_message", threadId, chatMessage);
                    }
                },
                onTurn: (actualTurnId) => {
                    turnId = actualTurnId;
                    session.setCodexState({ busy: true, threadId, turnId });
                },
                onFinish: () => {
                    session.clearTurnAttachments(clientId);
                    if (clientId) session.releaseClient(clientId);
                    session.setCodexState({ busy: false, threadId, turnId });
                },
            });
            res.json({ ok: true, threadId });
        } catch (error) {
            session.setCodexState({ busy: false, threadId: String(req.body?.threadId || workspace.activeThreadId || ""), turnId: "" });
            throw error;
        }
    }));
    app.post("/agent/codex/interrupt", (req, res) => {
        const ok = interruptCodexTurn(String(req.body?.threadId || ""));
        res.json({ ok });
    });
    app.post("/agent/claude/turn", (req, res) => {
        runClaudeTurn(withAgentPrompt(String(req.body?.prompt || "")), emit);
        res.json({ ok: true });
    });
    app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ ok: false, error: error.message }));

    app.listen(port, "127.0.0.1", () => {
        console.log("Infinite Canvas Agent");
        console.log(`Local URL: ${config.url}`);
        console.log(`Connect token: ${config.token}`);
        console.log("Codex MCP is not installed by this command.");
        console.log("Optional MCP add: codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent mcp");
        console.log("Remove manually added MCP: codex mcp remove infinite-canvas");
    });
}

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req, res).catch(next);
}

async function proxyVolcengineSpeech(req: Request, res: Response) {
    const body = (req.body || {}) as { baseUrl?: unknown; apiKey?: unknown; resourceId?: unknown; payload?: unknown };
    const apiKey = stringField(body.apiKey);
    const payload = body.payload && typeof body.payload === "object" ? body.payload : null;
    if (!apiKey || !payload) return void res.status(400).json({ ok: false, error: "missing volcengine apiKey or payload" });
    const upstream = await fetch(safeVolcengineSpeechUrl(stringField(body.baseUrl)), {
        method: "POST",
        headers: volcengineSpeechHeaders(apiKey, normalizeVolcengineResourceId(stringField(body.resourceId), volcengineSpeechSpeaker(payload))),
        body: JSON.stringify(payload),
    });
    const data = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    for (const name of ["x-tt-logid", "x-tt-log-id"]) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
    }
    res.send(data);
}

async function proxyVolcengineJson(req: Request, res: Response, fallbackPath: string) {
    const body = (req.body || {}) as { baseUrl?: unknown; apiKey?: unknown; path?: unknown; payload?: unknown };
    const apiKey = stringField(body.apiKey);
    const payload = body.payload && typeof body.payload === "object" ? body.payload : null;
    if (!apiKey || !payload) return void res.status(400).json({ ok: false, error: "missing volcengine apiKey or payload" });
    const upstream = await fetch(safeVolcengineApiUrl(stringField(body.baseUrl), stringField(body.path) || fallbackPath), {
        method: "POST",
        headers: volcengineJsonHeaders(apiKey),
        body: JSON.stringify(payload),
    });
    const data = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    for (const name of ["x-tt-logid", "x-tt-log-id"]) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
    }
    res.send(data);
}

async function proxyMediaDownload(req: Request, res: Response) {
    const url = safeRemoteMediaUrl(stringField((req.body || {}).url));
    if (!url) return void res.status(400).json({ ok: false, error: "missing media url" });
    const upstream = await fetch(url);
    const data = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    const length = upstream.headers.get("content-length");
    if (length) res.setHeader("Content-Length", length);
    res.send(data);
}

async function proxyVoicebox(req: Request, res: Response) {
    const body = (req.body || {}) as { baseUrl?: unknown; path?: unknown; method?: unknown; payload?: unknown };
    const method = stringField(body.method).toUpperCase() === "POST" ? "POST" : "GET";
    const url = safeVoiceboxUrl(stringField(body.baseUrl), stringField(body.path), method);
    let upstream: Awaited<ReturnType<typeof fetch>>;
    try {
        upstream = await fetch(url, {
            method,
            headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
            body: method === "POST" && body.payload && typeof body.payload === "object" ? JSON.stringify(body.payload) : undefined,
        });
    } catch {
        throw new Error("Voicebox local service is not running on 127.0.0.1:17493");
    }
    const data = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.send(data);
}

function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

function withAttachmentContext(prompt: string, attachments: Array<{ id: string; name: string }>) {
    if (!attachments.length) return prompt;
    const list = attachments.map((item, index) => `${index + 1}. attachmentId=${item.id}, name=${JSON.stringify(item.name)}`).join("\n");
    return `${prompt}\n\n本轮可用图片附件（顺序与图片输入一致）：\n${list}\n需要把附件放入画布或作为生成参考图时，先调用 canvas_create_attachment_nodes，再使用返回的画布节点 ID 创建生成流程。`;
}

const SEEDANCE_20_FILES = [
    "SKILL.md",
    "skills/seedance-prompt/SKILL.md",
    "skills/seedance-camera/SKILL.md",
    "skills/seedance-motion/SKILL.md",
    "skills/seedance-characters/SKILL.md",
    "skills/seedance-audio/SKILL.md",
    "skills/seedance-antislop/SKILL.md",
    "skills/seedance-filter/SKILL.md",
    "skills/seedance-troubleshoot/SKILL.md",
    "references/quick-ref.md",
    "references/reference-workflow.md",
    "references/storytelling-framework.md",
] as const;

async function loadSeedance20Context() {
    const root = await findSeedance20Root();
    if (!root) throw new Error("seedance-20 skill package not found; set SEEDANCE_20_SKILL_ROOT to the package directory");
    const files = await Promise.all(
        SEEDANCE_20_FILES.map(async (relativePath) => ({
            path: relativePath,
            content: await fs.readFile(path.join(root, relativePath), "utf8"),
        })),
    );
    return { root, files };
}

async function findSeedance20Root() {
    const candidates = [
        process.env.SEEDANCE_20_SKILL_ROOT || "",
        path.resolve(process.cwd(), "seedance-2.0-5.3.0", "seedance-2.0-5.3.0"),
        path.resolve(process.cwd(), "..", "seedance-2.0-5.3.0", "seedance-2.0-5.3.0"),
        path.resolve(process.cwd(), "..", "..", "seedance-2.0-5.3.0", "seedance-2.0-5.3.0"),
    ].filter(Boolean);
    for (const candidate of candidates) {
        const root = path.resolve(candidate);
        try {
            await fs.access(path.join(root, "SKILL.md"));
            await fs.access(path.join(root, "skills", "seedance-prompt", "SKILL.md"));
            return root;
        } catch {
            // try next candidate
        }
    }
    return "";
}

const SCREENWRITING_FILES = ["SKILL.md", "references/automatic-story-planning.md"] as const;

async function loadScreenwritingContext() {
    const root = await findScreenwritingRoot();
    if (!root) throw new Error("Infinite Canvas screenwriting skill not found; set SCREENWRITING_SKILL_ROOT to the skill directory");
    const files = await Promise.all(SCREENWRITING_FILES.map(async (relativePath) => ({ path: relativePath, content: await fs.readFile(path.join(root, relativePath), "utf8") })));
    return { root, files };
}

async function findScreenwritingRoot() {
    const candidates = [
        process.env.SCREENWRITING_SKILL_ROOT || "",
        path.resolve(process.cwd(), ".agents", "skills", "infinite-canvas-screenwriting"),
        path.resolve(process.cwd(), "..", ".agents", "skills", "infinite-canvas-screenwriting"),
        path.resolve(process.cwd(), "..", "..", ".agents", "skills", "infinite-canvas-screenwriting"),
    ].filter(Boolean);
    for (const candidate of candidates) {
        const root = path.resolve(candidate);
        try {
            await fs.access(path.join(root, "SKILL.md"));
            await fs.access(path.join(root, "references", "automatic-story-planning.md"));
            return root;
        } catch {
            // try next candidate
        }
    }
    return "";
}

function requestUrl(req: Request, config: CanvasAgentConfig) {
    return new URL(req.originalUrl || req.url || "/", config.url);
}

function safeVolcengineSpeechUrl(baseUrl: string) {
    const url = new URL(volcengineSpeechUrl(baseUrl || "https://openspeech.bytedance.com"));
    if (url.protocol !== "https:" || url.hostname !== "openspeech.bytedance.com") throw new Error("only openspeech.bytedance.com is allowed");
    return url.toString();
}

function safeVolcengineApiUrl(baseUrl: string, apiPath: string) {
    const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
    if (!["/api/v3/tts/voice_clone", "/api/v3/tts/get_voice"].includes(path)) throw new Error("unsupported volcengine api path");
    const base = baseUrl.trim().replace(/\/+$/, "") || "https://openspeech.bytedance.com";
    const url = new URL(`${base.replace(/\/api\/v3\/tts(?:\/.*)?$/i, "")}${path}`);
    if (url.protocol !== "https:" || url.hostname !== "openspeech.bytedance.com") throw new Error("only openspeech.bytedance.com is allowed");
    return url.toString();
}

function safeRemoteMediaUrl(value: string) {
    if (!value) return "";
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("only https media urls are allowed");
    return url.toString();
}

function safeVoiceboxUrl(baseUrl: string, apiPath: string, method: string) {
    const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
    const allowed = method === "GET"
        ? path === "/health" || path === "/profiles" || path === "/settings/generation" || /^\/profiles\/[\w-]+$/.test(path) || /^\/(history|audio)\/[\w-]+$/.test(path)
        : path === "/generate" || /^\/generate\/[\w-]+\/cancel$/.test(path);
    if (!allowed) throw new Error("unsupported Voicebox API path");
    const base = baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "") || "http://127.0.0.1:17493";
    const url = new URL(`${base}${path}`);
    if (url.protocol !== "http:" || url.port !== "17493" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) throw new Error("only local Voicebox on port 17493 is allowed");
    return url.toString();
}

function volcengineSpeechUrl(baseUrl: string) {
    const base = baseUrl.trim().replace(/\/+$/, "") || "https://openspeech.bytedance.com";
    if (/\/api\/v3\/tts\/unidirectional$/i.test(base)) return base;
    return `${base.replace(/\/api\/v3\/tts(?:\/.*)?$/i, "")}/api/v3/tts/unidirectional`;
}

function normalizeVolcengineResourceId(value: string, speaker = "") {
    const inferred = inferVolcengineResourceIdFromSpeaker(speaker);
    if (inferred) return inferred;
    const resourceId = value.trim();
    if (/^tts-seedtts2/i.test(resourceId) || /seedtts2/i.test(resourceId)) return "seed-tts-2.0";
    if (/^tts-seedicl2/i.test(resourceId) || /seedicl2/i.test(resourceId)) return "seed-icl-2.0";
    if (/^(seed-(tts|icl)-|volc\.service_type\.)/i.test(resourceId)) return resourceId;
    return "seed-tts-2.0";
}

function volcengineSpeechSpeaker(payload: object) {
    const reqParams = (payload as { req_params?: unknown }).req_params;
    return reqParams && typeof reqParams === "object" ? stringField((reqParams as { speaker?: unknown }).speaker) : "";
}

function inferVolcengineResourceIdFromSpeaker(value: string) {
    const speaker = value.trim().toLowerCase();
    if (!speaker) return "";
    if (/(^s_|_icl_|clone|voiceclone)/i.test(speaker)) return "seed-icl-2.0";
    if (/_uranus_bigtts$/i.test(speaker)) return "seed-tts-2.0";
    return "";
}

function volcengineSpeechHeaders(apiKey: string, resourceId: string) {
    const legacy = parseVolcengineLegacyAuth(apiKey);
    if (legacy) {
        return {
            "Content-Type": "application/json",
            "X-Api-App-Id": legacy.appId,
            "X-Api-Access-Key": legacy.accessToken,
            "X-Api-Connect-Id": cryptoRandomId(),
            "X-Api-Resource-Id": resourceId,
        };
    }
    return {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "X-Api-Connect-Id": cryptoRandomId(),
        "X-Api-Resource-Id": resourceId,
    };
}

function volcengineJsonHeaders(apiKey: string) {
    const legacy = parseVolcengineLegacyAuth(apiKey);
    if (legacy) {
        return {
            "Content-Type": "application/json",
            "X-Api-App-Key": legacy.appId,
            "X-Api-App-Id": legacy.appId,
            "X-Api-Access-Key": legacy.accessToken,
            "X-Api-Request-Id": cryptoRandomId(),
        };
    }
    return {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "X-Api-Request-Id": cryptoRandomId(),
    };
}

function parseVolcengineLegacyAuth(value: string) {
    const source = value.trim();
    if (!source) return null;
    if (source.startsWith("{")) {
        try {
            const payload = JSON.parse(source) as { appId?: string; app_id?: string; accessToken?: string; access_token?: string; accessKey?: string; access_key?: string };
            const appId = stringField(payload.appId || payload.app_id);
            const accessToken = stringField(payload.accessToken || payload.access_token || payload.accessKey || payload.access_key);
            return appId && accessToken ? { appId, accessToken } : null;
        } catch {
            return null;
        }
    }
    const parts = source.split(/[|,\s]+/).map((item) => item.trim()).filter(Boolean);
    return parts.length >= 2 && /^\d{6,}$/.test(parts[0]) ? { appId: parts[0], accessToken: parts[1] } : null;
}

function stringField(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function cryptoRandomId() {
    return randomUUID();
}

function setCors(req: Request, res: Response, url: URL, config: CanvasAgentConfig) {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-canvas-agent-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (!origin || req.method === "OPTIONS" || url.pathname === "/health" || url.pathname === "/config") return true;
    config.origins ||= [];
    if (validToken(req, url, config.token) && !config.origins.includes(origin)) {
        config.origins.push(origin);
        saveConfig(config);
    }
    res.setHeader("Vary", "Origin");
    return config.origins.includes(origin);
}

function validToken(req: Request, url: URL, token: string) {
    const header = req.headers["x-canvas-agent-token"];
    return url.searchParams.get("token") === token || header === token || (Array.isArray(header) && header.includes(token));
}
