import { describe, expect, it } from "vitest";
import { resolveUsageRate } from "./token-usage-rate-catalog";

describe("built-in token usage rate catalog", () => {
  it.each([
    ["codex", "openai", "gpt-5-mini"], ["codex", "openai", "gpt-5.3-codex"],
    ["codex", "openai", "gpt-5.4"], ["codex", "openai", "gpt-5.4-mini"], ["codex", "openai", "gpt-5.4-nano"],
    ["codex", "openai", "gpt-5.5"], ["codex", "openai", "gpt-5.6-luna"], ["codex", "openai", "gpt-5.6-sol"],
    ["codex", "openai", "gpt-5.6-terra"], ["codex", "openai", "gpt-6-astra"],
    ["claude-code", "anthropic", "claude-fable-5-1"], ["claude-code", "anthropic", "claude-mythos-5-1"],
    ["claude-code", "anthropic", "claude-fable-5"], ["claude-code", "anthropic", "claude-mythos-5"],
    ["claude-code", "anthropic", "claude-opus-5"], ["claude-code", "anthropic", "claude-opus-4-8"],
    ["claude-code", "anthropic", "claude-opus-4-7"], ["claude-code", "anthropic", "claude-opus-4-6"],
    ["claude-code", "anthropic", "claude-opus-4-5-20251101"], ["claude-code", "anthropic", "claude-sonnet-5"],
    ["claude-code", "anthropic", "claude-sonnet-4-6"], ["claude-code", "anthropic", "claude-sonnet-4-5-20250929"],
    ["claude-code", "anthropic", "claude-haiku-4-5-20251001"],
    ...[
      "gpt-5-mini", "gpt-5.3-codex", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.5",
      "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra",
      "claude-haiku-4.5", "claude-sonnet-4.6", "claude-opus-4.7", "claude-opus-4.8", "claude-opus-5",
      "claude-sonnet-5", "claude-fable-5", "claude-fable-5.1",
      "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash",
      "mai-code-1-flash", "mai-code-1.1-flash", "grok-4.5", "grok-4.6", "kimi-k2.7-code", "kimi-k3",
    ].map(model => ["copilot", "github", model]),
  ] as const)("covers the current %s model %s", (host, provider, model) => {
    expect(resolveUsageRate({
      host, provider, model,
      usage: { uncachedInputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2 },
      observedAt: "2026-09-08T12:00:00Z",
    }).status).toBe("resolved");
  });

  it("resolves an exact documented alias for the selected host", () => {
    expect(resolveUsageRate({
      host: "codex",
      provider: "openai",
      model: "gpt-5.6",
      usage: {
        uncachedInputTokens: 100,
        cachedInputTokens: 900,
        cacheWriteTokens: 0,
        outputTokens: 20,
      },
      observedAt: "2026-09-08T12:00:00Z",
    })).toMatchObject({
      status: "resolved",
      model: { provider: "openai", name: "gpt-5.6-sol" },
      context: { tier: "default", tokens: 1000 },
      rateCard: {
        provider: "openai",
        model: "gpt-5.6-sol",
        currency: "USD",
        contextTier: { name: "default", minTokens: 0, maxTokens: 272000 },
        perMillion: {
          uncachedInputTokens: 4,
          cachedInputTokens: 0.4,
          cacheWriteTokens: 5,
          outputTokens: 20,
        },
      },
    });
  });

  it("selects host-specific context tiers and first-party Claude pricing", () => {
    expect(resolveUsageRate({
      host: "codex", provider: "openai", model: "gpt-6-astra",
      usage: { uncachedInputTokens: 272001, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
      observedAt: "2026-09-08T12:00:00Z",
    })).toMatchObject({
      status: "resolved",
      context: { tier: "long", tokens: 272001 },
      rateCard: { perMillion: { uncachedInputTokens: 20, cachedInputTokens: 2, cacheWriteTokens: 25, outputTokens: 75 } },
    });
    expect(resolveUsageRate({
      host: "copilot", provider: "github", model: "gpt-5.6-luna",
      usage: { uncachedInputTokens: 200001, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
      observedAt: "2026-09-08T12:00:00Z",
    })).toMatchObject({
      status: "resolved",
      model: { provider: "openai", name: "gpt-5.6-luna" },
      context: { tier: "long", tokens: 200001 },
      rateCard: { id: "github-copilot:gpt-5.6-luna:2026-09-08:long" },
    });
    expect(resolveUsageRate({
      host: "claude-code", provider: "anthropic", model: "claude-sonnet-5",
      usage: { uncachedInputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10 },
      observedAt: "2026-09-08T12:00:00Z",
    })).toMatchObject({
      status: "resolved",
      model: { provider: "anthropic", name: "claude-sonnet-5" },
      context: { tier: "default", tokens: 100 },
      rateCard: { perMillion: { uncachedInputTokens: 2, cachedInputTokens: 0.2, cacheWriteTokens: 2.5, outputTokens: 10 } },
    });
  });

  it("fails closed for unknown context, dates, promotions, and model names", () => {
    const base = { host: "codex" as const, provider: "openai", model: "gpt-5.6-sol" };
    expect(resolveUsageRate({ ...base, usage: { uncachedInputTokens: 1 }, observedAt: "2026-09-08T12:00:00Z" }))
      .toMatchObject({ status: "unpriced", reason: expect.stringMatching(/context/i) });
    expect(resolveUsageRate({ ...base, usage: { uncachedInputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 }, observedAt: "2026-09-07T23:59:59Z" }))
      .toMatchObject({ status: "unpriced", reason: expect.stringMatching(/applicable/i) });
    expect(resolveUsageRate({ ...base, usage: { uncachedInputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 }, observedAt: "2026-11-22T00:00:00Z" }))
      .toMatchObject({ status: "unpriced", reason: expect.stringMatching(/applicable/i) });
    expect(resolveUsageRate({ ...base, model: "gpt-5.6-so", usage: { uncachedInputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 }, observedAt: "2026-09-08T12:00:00Z" }))
      .toMatchObject({ status: "unpriced", reason: expect.stringMatching(/unknown/i) });
    expect(resolveUsageRate({
      ...base, model: "gpt-5.3-codex-spark",
      usage: { uncachedInputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
      observedAt: "2026-09-08T12:00:00Z",
    })).toMatchObject({ status: "unpriced", reason: expect.stringMatching(/unknown/i) });
  });

  it("uses an unbounded tier without inventing an unknown context count", () => {
    expect(resolveUsageRate({
      host: "copilot", provider: "github-copilot", model: "gpt-5-mini",
      usage: { uncachedInputTokens: 10, outputTokens: 2 }, observedAt: "2026-09-08T12:00:00Z",
    })).toMatchObject({
      status: "resolved",
      context: { tier: "default" },
      rateCard: { perMillion: { uncachedInputTokens: 0.25, cachedInputTokens: 0.025, cacheWriteTokens: 0, outputTokens: 2 } },
    });
  });

  it("resolves documented dated Anthropic IDs and dotted Copilot CLI IDs exactly", () => {
    expect(resolveUsageRate({
      host: "claude-code", provider: "anthropic", model: "claude-haiku-4-5-20251001",
      usage: { uncachedInputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2 },
      observedAt: "2026-09-08T12:00:00Z",
    })).toMatchObject({ status: "resolved", model: { name: "claude-haiku-4-5" } });
    expect(resolveUsageRate({
      host: "copilot", provider: "github", model: "claude-sonnet-4.6",
      usage: { uncachedInputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2 },
      observedAt: "2026-09-08T12:00:00Z",
    })).toMatchObject({
      status: "resolved",
      model: { provider: "anthropic", name: "claude-sonnet-4.6" },
      rateCard: { id: "github-copilot:claude-sonnet-4.6:2026-09-08:default" },
    });
  });

  it("pins promotional Copilot rows to their documented expiry", () => {
    const result = resolveUsageRate({
      host: "copilot", provider: "github", model: "gemini-3.8-flash",
      usage: { uncachedInputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2 },
      observedAt: "2026-12-31T23:59:59Z",
    });
    expect(result).toMatchObject({ status: "resolved", rateCard: { provider: "google", expiresAt: "2027-01-01T00:00:00Z" } });
    expect(resolveUsageRate({
      host: "copilot", provider: "github", model: "gemini-3.8-flash",
      usage: { uncachedInputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2 },
      observedAt: "2027-01-01T00:00:00Z",
    })).toMatchObject({ status: "unpriced" });
  });
});
