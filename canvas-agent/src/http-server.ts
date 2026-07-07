import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";

import { DEFAULT_PORT, ensureCanvasWorkspace, loadConfig, saveConfig, updateCanvasWorkspace, type CanvasAgentConfig } from "./config.js";
import { CanvasSession } from "./canvas-session.js";
import { archiveCodexThread, listCodexThreads, readCodexThread, resumeCodexThread, runClaudeTurn, runCodexTurn, startCodexThread, summarizeCodexThread, verifyCodexThreadWorkspace, withAgentPrompt } from "./agents.js";
import type { AgentAttachment } from "./types.js";

export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const session = new CanvasSession();
    const emit = (type: string, payload: unknown) => session.emitAll(type, payload);
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
    app.post("/canvas/result", (req, res) => {
        session.resolveResult(req.body);
        res.json({ ok: true });
    });
    app.post("/api/tools", route(async (req, res) => res.json({ ok: true, result: await session.callTool(req.body?.name, req.body?.input || {}) })));
    app.post("/api/proxy/volcengine/tts", route(proxyVolcengineSpeech));
    app.get("/agent/codex/workspace", (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.query.canvasId || ""));
        res.json({ ok: true, workspace });
    });
    app.get("/agent/codex/threads", route(async (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.query.canvasId || ""));
        const result = await listCodexThreads(emit, { cwd: workspace.workspacePath, searchTerm: String(req.query.searchTerm || "") });
        res.json({ ok: true, workspace, ...result });
    }));
    app.post("/agent/codex/threads/new", route(async (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.body?.canvasId || ""));
        const thread = await startCodexThread(emit, workspace.workspacePath);
        const activeThreadId = String((thread as Record<string, unknown>).id || "");
        updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId });
        res.json({ ok: true, workspace: { ...workspace, activeThreadId }, thread: summarizeCodexThread(thread), messages: [] });
    }));
    app.get("/agent/codex/threads/:threadId", route(async (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.query.canvasId || ""));
        const threadId = routeParam(req.params.threadId);
        res.json({ ok: true, workspace, ...(await readCodexThread(emit, threadId, workspace.workspacePath)) });
    }));
    app.post("/agent/codex/threads/:threadId/resume", route(async (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.body?.canvasId || ""));
        const threadId = routeParam(req.params.threadId);
        const result = await resumeCodexThread(emit, threadId, workspace.workspacePath);
        updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: threadId });
        res.json({ ok: true, workspace: { ...workspace, activeThreadId: threadId }, ...result });
    }));
    app.post("/agent/codex/threads/:threadId/delete", route(async (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.body?.canvasId || ""));
        const threadId = routeParam(req.params.threadId);
        await archiveCodexThread(emit, threadId, workspace.workspacePath);
        if (workspace.activeThreadId === threadId) updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: undefined });
        res.json({ ok: true });
    }));
    app.post("/agent/codex/turn", route(async (req, res) => {
        const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as AgentAttachment[]) : [];
        const workspace = ensureCanvasWorkspace(config, String(req.body?.canvasId || ""));
        let threadId = String(req.body?.threadId || workspace.activeThreadId || "");
        if (!threadId) {
            const thread = await startCodexThread(emit, workspace.workspacePath);
            threadId = String((thread as Record<string, unknown>).id || "");
            updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: threadId });
        } else if (threadId !== workspace.activeThreadId) {
            await verifyCodexThreadWorkspace(emit, threadId, workspace.workspacePath);
            updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: threadId });
        }
        void runCodexTurn(withAgentPrompt(String(req.body?.prompt || "")), emit, attachments, { threadId, cwd: workspace.workspacePath });
        res.json({ ok: true, threadId });
    }));
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
        console.log("Codex MCP: codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent mcp");
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
        headers: {
            "Content-Type": "application/json",
            "X-Api-Key": apiKey,
            "X-Api-Connect-Id": cryptoRandomId(),
            "X-Api-Resource-Id": normalizeVolcengineResourceId(stringField(body.resourceId)),
        },
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

function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

function requestUrl(req: Request, config: CanvasAgentConfig) {
    return new URL(req.originalUrl || req.url || "/", config.url);
}

function safeVolcengineSpeechUrl(baseUrl: string) {
    const url = new URL(volcengineSpeechUrl(baseUrl || "https://openspeech.bytedance.com"));
    if (url.protocol !== "https:" || url.hostname !== "openspeech.bytedance.com") throw new Error("only openspeech.bytedance.com is allowed");
    return url.toString();
}

function volcengineSpeechUrl(baseUrl: string) {
    const base = baseUrl.trim().replace(/\/+$/, "") || "https://openspeech.bytedance.com";
    if (/\/api\/v3\/tts\/unidirectional$/i.test(base)) return base;
    return `${base.replace(/\/api\/v3\/tts(?:\/.*)?$/i, "")}/api/v3/tts/unidirectional`;
}

function normalizeVolcengineResourceId(value: string) {
    const resourceId = value.trim();
    if (/^tts-seedtts2/i.test(resourceId) || /seedtts2/i.test(resourceId)) return "seed-tts-2.0";
    if (/^tts-seedicl2/i.test(resourceId) || /seedicl2/i.test(resourceId)) return "seed-icl-2.0";
    if (/^seed-(tts|icl)-/i.test(resourceId)) return resourceId;
    return "seed-tts-2.0";
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
