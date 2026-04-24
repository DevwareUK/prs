import { defaultProvider } from "@aws-sdk/credential-provider-node";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { BedrockClaudeProvider } from "./bedrock-claude";
import { OpenAIProvider } from "./openai";
import type { AIProvider } from "./provider";

export type ProviderFactoryConfig =
  | {
      type: "openai";
      model?: string;
      baseUrl?: string;
    }
  | {
      type: "bedrock-claude";
      model: string;
      region?: string;
    };

export type ProviderEnvironment = {
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
  awsRegion?: string;
  awsDefaultRegion?: string;
};

type CreateProviderFromConfigOptions = {
  credentialProvider?: AwsCredentialIdentityProvider;
};

export function readProviderEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): ProviderEnvironment {
  return {
    openaiApiKey: environment.OPENAI_API_KEY?.trim() || undefined,
    openaiModel: environment.OPENAI_MODEL?.trim() || undefined,
    openaiBaseUrl: environment.OPENAI_BASE_URL?.trim() || undefined,
    awsRegion: environment.AWS_REGION?.trim() || undefined,
    awsDefaultRegion: environment.AWS_DEFAULT_REGION?.trim() || undefined,
  };
}

function getBedrockRegion(
  config: Extract<ProviderFactoryConfig, { type: "bedrock-claude" }>,
  environment: ProviderEnvironment
): string {
  const region =
    config.region?.trim() ||
    environment.awsRegion?.trim() ||
    environment.awsDefaultRegion?.trim();

  if (!region) {
    throw new Error(
      "Bedrock Claude provider requires a region. Set `ai.provider.region`, `AWS_REGION`, or `AWS_DEFAULT_REGION`."
    );
  }

  return region;
}

async function getBedrockCredentialProvider(
  options: CreateProviderFromConfigOptions
): Promise<AwsCredentialIdentityProvider> {
  const credentialProvider = options.credentialProvider ?? defaultProvider();

  try {
    await credentialProvider();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      "Bedrock Claude provider could not resolve AWS credentials using the standard AWS provider chain. " +
        message
    );
  }

  return credentialProvider;
}

export async function createProviderFromConfig(
  config: ProviderFactoryConfig,
  environment: ProviderEnvironment = readProviderEnvironment(),
  options: CreateProviderFromConfigOptions = {}
): Promise<AIProvider> {
  if (config.type === "openai") {
    if (!environment.openaiApiKey) {
      throw new Error(
        "OpenAI provider requires OPENAI_API_KEY. Set it in your environment or in a .env file."
      );
    }

    return new OpenAIProvider({
      apiKey: environment.openaiApiKey,
      model: config.model ?? environment.openaiModel,
      baseUrl: config.baseUrl ?? environment.openaiBaseUrl,
    });
  }

  const model = config.model?.trim();
  if (!model) {
    throw new Error(
      "Bedrock Claude provider requires an explicit model in `.prs/config.json` under `ai.provider.model`."
    );
  }

  const credentialProvider = await getBedrockCredentialProvider(options);

  return new BedrockClaudeProvider({
    model,
    region: getBedrockRegion(config, environment),
    credentials: credentialProvider,
  });
}
