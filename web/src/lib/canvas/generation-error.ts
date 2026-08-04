export function generationErrorDisplayText(value: unknown, fallback = "生成失败") {
    const raw = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
    if (/servers? (?:are )?currently overloaded|server overload|service unavailable|temporarily unavailable|over capacity/i.test(raw)) {
        return "模型服务当前繁忙，请稍后点击“直接重试”。";
    }
    if (/too many requests|rate limit|status\s*429|\b429\b/i.test(raw)) {
        return "请求过于频繁，请稍后点击“直接重试”。";
    }
    return raw || fallback;
}
