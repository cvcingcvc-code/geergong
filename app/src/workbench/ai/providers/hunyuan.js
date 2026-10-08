// Gorgon Workbench — HunyuanProvider (Phase 4B.4).
//
// Implements the SAME AIProvider contract as MockProvider, so nothing upstream
// (Skill → Gate → AI client) can tell the difference.
//
// SAFETY RULES (non-negotiable, §4B.4):
//   * The API key is NEVER hardcoded here. It is read from the environment by
//     the caller and passed in via config.
//   * If no key is configured the provider is never constructed — createProvider
//     returns MockProvider instead, so the app stays fully runnable offline.
//   * The key is never written into a result, a log line, or the UI.
//
// The network call goes through an INJECTED transport (`config.fetch`), defaulting
// to globalThis.fetch. That keeps this file unit-testable in plain Node with zero
// network access, and keeps secrets out of the test suite.

import { AIProvider, createAIResponse, createAIError, normalizePurpose } from "../provider.js";

export const HUNYUAN_DEFAULT_BASE_URL = "https://api.hunyuan.cloud.tencent.com/v1";
export const HUNYUAN_DEFAULT_MODEL = "hunyuan-turbos-latest";
export const HUNYUAN_DEFAULT_TIMEOUT_MS = 20000;

const SYSTEM_PROMPT = {
  summarize: "你是一个严谨的中文摘要助手。只输出摘要正文，不要解释。",
  extract: "你是一个信息抽取助手。只输出 JSON，不要任何额外文字。",
  plan: "你是一个行动规划助手。输出简洁、可执行的中文步骤列表。",
  generate: "你是一个中文写作助手。直接输出正文。",
  route: "你是一个意图识别助手。只输出 JSON。",
};

function joinInput(input) {
  return typeof input === "string" ? input : String(input == null ? "" : input);
}

/**
 * Parse a provider payload into our normalized response shape. Kept tolerant:
 * a malformed body becomes an explicit error, never a fabricated success.
 */
function parseCompletion(payload, { provider, model, purpose, input }) {
  const choice =
    payload && Array.isArray(payload.choices) && payload.choices.length
      ? payload.choices[0]
      : null;
  const content =
    choice && choice.message && typeof choice.message.content === "string"
      ? choice.message.content
      : "";

  if (!content) {
    return createAIError("AI_EMPTY_RESPONSE", "模型返回内容为空");
  }

  const usage = (payload && payload.usage) || {};
  return createAIResponse({
    content,
    provider,
    model: (payload && payload.model) || model,
    purpose,
    usage: {
      inputTokens: Number(usage.prompt_tokens) || Number(usage.input_tokens) || joinInput(input).length,
      outputTokens: Number(usage.completion_tokens) || Number(usage.output_tokens) || content.length,
    },
    cached: false,
  });
}

export class HunyuanProvider extends AIProvider {
  constructor(config = {}) {
    const apiKey = typeof config.apiKey === "string" ? config.apiKey : "";
    super({
      ...config,
      provider: "hunyuan",
      model: config.model || HUNYUAN_DEFAULT_MODEL,
      baseURL: config.baseURL || HUNYUAN_DEFAULT_BASE_URL,
      timeoutMs: Number(config.timeoutMs) || HUNYUAN_DEFAULT_TIMEOUT_MS,
    });
    this.apiKey = apiKey;
    this.fetchImpl =
      typeof config.fetch === "function"
        ? config.fetch
        : typeof globalThis.fetch === "function"
          ? globalThis.fetch.bind(globalThis)
          : null;
  }

  /** True only when a key AND a transport exist. Never guesses a key. */
  get usable() {
    return this.apiKey.length > 0 && typeof this.fetchImpl === "function";
  }

  async generate(request) {
    if (!request || typeof request !== "object") {
      return createAIError("AI_INVALID_REQUEST", "request 必须为对象");
    }
    const purpose = normalizePurpose(request.purpose);
    const input = joinInput(request.input);
    if (input.trim() === "") {
      return createAIError("AI_EMPTY_INPUT", "input 不能为空");
    }
    if (!this.usable) {
      return createAIError("AI_NOT_CONFIGURED", "未配置混元 API Key 或网络不可用");
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), this.config.timeoutMs)
      : null;

    try {
      const res = await this.fetchImpl(`${this.config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT[purpose] || SYSTEM_PROMPT.generate },
            { role: "user", content: input },
          ],
          temperature: Number.isFinite(request.temperature) ? request.temperature : 0.3,
          stream: false,
        }),
        signal: controller ? controller.signal : undefined,
      });

      if (!res || !res.ok) {
        const status = res && res.status ? res.status : 0;
        // 429/5xx are transient → let the caller fall back rather than fail hard.
        const code = status === 429 ? "AI_RATE_LIMITED" : "AI_PROVIDER_ERROR";
        return createAIError(code, `混元接口返回状态 ${status}`);
      }

      const payload = await res.json();
      return parseCompletion(payload, {
        provider: "hunyuan",
        model: this.config.model,
        purpose,
        input,
      });
    } catch (e) {
      const aborted = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
      if (aborted) return createAIError("AI_TIMEOUT", "混元接口请求超时");
      return createAIError("AI_NETWORK_ERROR", `混元接口网络错误：${String((e && e.message) || e)}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export default HunyuanProvider;
