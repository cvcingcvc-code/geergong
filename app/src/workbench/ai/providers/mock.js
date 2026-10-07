// MockProvider — a deterministic, offline model stand-in.
//
// Used to validate the entire AI interface without any network call, API key, or
// paid endpoint. It never touches the internet and never reads secrets. Real model
// adapters (OpenAI/DeepSeek/etc.) can be added later behind explicit config + key;
// until then this is what the factory returns.

import { AIProvider, createAIResponse, createAIError, normalizePurpose } from "../provider.js";

const CANNED = Object.freeze({
  summarize: "（本地 Mock 摘要）这是由 MockProvider 生成的非联网摘要内容，仅用于验证接口。",
  extract: "（本地 Mock 提取）已抽取关键字段，仅用于验证接口。",
  plan: "（本地 Mock 计划）步骤一：明确目标；步骤二：拆解任务；步骤三：执行并复盘。",
  generate: "（本地 Mock 生成）这是模型应返回的文本内容占位，仅用于验证接口。",
  route: "（本地 Mock 路由）本地规则未能判定意图，建议人工复核或补充关键词。",
});

export class MockProvider extends AIProvider {
  constructor(config = {}) {
    super({
      ...config,
      provider: "mock",
      model: config.model || "mock-model",
    });
    // Optional artificial latency for testing timeouts (0 = instant).
    this.latencyMs = Number(config.latencyMs) || 0;
  }

  async generate(request) {
    if (!request || typeof request !== "object") {
      return createAIError("AI_INVALID_REQUEST", "request 必须为对象");
    }
    const purpose = normalizePurpose(request.purpose);
    const input = request.input;
    if (typeof input !== "string" || input.trim() === "") {
      return createAIError("AI_EMPTY_INPUT", "input 不能为空");
    }

    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    const content = CANNED[purpose] || CANNED.generate;
    return createAIResponse({
      content,
      provider: "mock",
      model: this.config.model,
      purpose,
      usage: {
        inputTokens: input.length,
        outputTokens: Math.max(content.length, 1),
      },
      cached: false,
    });
  }
}
