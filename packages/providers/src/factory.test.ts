import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProviderFromConfig,
  type ProviderEnvironment,
  readProviderEnvironment,
} from "./factory";

describe("readProviderEnvironment", () => {
  it("maps supported provider environment variables", () => {
    expect(
      readProviderEnvironment({
        AWS_DEFAULT_REGION: "eu-west-1",
        AWS_REGION: "us-east-1",
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: "https://example.com/v1",
        OPENAI_MODEL: "gpt-4.1-mini",
      })
    ).toEqual({
      awsDefaultRegion: "eu-west-1",
      awsRegion: "us-east-1",
      openaiApiKey: "test-key",
      openaiBaseUrl: "https://example.com/v1",
      openaiModel: "gpt-4.1-mini",
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createProviderFromConfig", () => {
  it("creates an OpenAI provider from environment defaults", async () => {
    const provider = await createProviderFromConfig(
      {
        type: "openai",
      },
      {
        openaiApiKey: "test-key",
        openaiModel: "gpt-4.1-mini",
        openaiBaseUrl: "https://example.com/v1",
      }
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "ready",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider.generateText({ prompt: "Hello" })).resolves.toBe("ready");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("allows OpenAI model override through options", async () => {
    const provider = await createProviderFromConfig(
      {
        type: "openai",
        model: "gpt-4.1-mini",
      },
      {
        openaiApiKey: "test-key",
      },
      {
        modelOverride: "gpt-5",
      }
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "ready",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider.generateText({ prompt: "Hello" })).resolves.toBe("ready");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        body: expect.stringContaining('"model":"gpt-5"'),
      })
    );
  });

  it("fails OpenAI creation clearly when the API key is missing", async () => {
    await expect(
      createProviderFromConfig(
        {
          type: "openai",
        },
        {}
      )
    ).rejects.toThrow(
      "OpenAI provider requires OPENAI_API_KEY. Set it in your environment or in a .env file."
    );
  });

  it("creates a Bedrock Claude provider with config region and model", async () => {
    const credentialProvider = vi.fn().mockResolvedValue({
      accessKeyId: "key",
      secretAccessKey: "secret",
    });

    const provider = await createProviderFromConfig(
      {
        type: "bedrock-claude",
        model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
        region: "eu-west-1",
      },
      {},
      {
        credentialProvider,
      }
    );

    expect(credentialProvider).toHaveBeenCalledTimes(1);
    expect(provider).toBeDefined();
  });

  it("falls back to AWS_REGION for Bedrock Claude region resolution", async () => {
    const credentialProvider = vi.fn().mockResolvedValue({
      accessKeyId: "key",
      secretAccessKey: "secret",
    });
    const environment: ProviderEnvironment = {
      awsRegion: "us-west-2",
    };

    const provider = await createProviderFromConfig(
      {
        type: "bedrock-claude",
        model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      },
      environment,
      {
        credentialProvider,
      }
    );

    expect(provider).toBeDefined();
  });

  it("fails Bedrock Claude creation clearly when region cannot be resolved", async () => {
    const credentialProvider = vi.fn().mockResolvedValue({
      accessKeyId: "key",
      secretAccessKey: "secret",
    });

    await expect(
      createProviderFromConfig(
        {
          type: "bedrock-claude",
          model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
        },
        {},
        {
          credentialProvider,
        }
      )
    ).rejects.toThrow(
      "Bedrock Claude provider requires a region. Set `ai.provider.region`, `AWS_REGION`, or `AWS_DEFAULT_REGION`."
    );
  });

  it("fails Bedrock Claude creation clearly when AWS credentials are unavailable", async () => {
    const credentialProvider = vi.fn().mockRejectedValue(new Error("credentials missing"));

    await expect(
      createProviderFromConfig(
        {
          type: "bedrock-claude",
          model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
          region: "eu-west-1",
        },
        {},
        {
          credentialProvider,
        }
      )
    ).rejects.toThrow(
      "Bedrock Claude provider could not resolve AWS credentials using the standard AWS provider chain. credentials missing"
    );
  });
});
