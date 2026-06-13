import { resolve } from "node:path";
import type { ResolvedRepositoryConfigType, RepositoryAiWorkflowRole } from "@prs/contracts";
import {
  createProviderFromConfig,
  type AIProvider,
  readProviderEnvironment,
} from "@prs/providers";
import dotenv from "dotenv";
import { loadResolvedRepositoryConfig } from "./config";
import { createRepositoryForge, type RepositoryForge } from "./forge";
import { resolveRuntimeRepoRoot } from "./repo-root";

export function getCliArgs(): string[] {
  return process.argv.slice(2).filter((arg) => arg !== "--");
}

export function getDefaultRepoRoot(): string {
  return resolveRuntimeRepoRoot();
}

export function loadRepoEnv(repoRoot: string): void {
  dotenv.config({ path: resolve(repoRoot, ".env"), quiet: true });
}

export function getRepositoryConfig(repoRoot = getDefaultRepoRoot()) {
  return loadResolvedRepositoryConfig(repoRoot);
}

export function getRepositoryForge(repoRoot = getDefaultRepoRoot()): RepositoryForge {
  return createRepositoryForge(repoRoot, getRepositoryConfig(repoRoot));
}

export async function createProvider(
  repoRoot = getDefaultRepoRoot(),
  workflowRole: RepositoryAiWorkflowRole = "implementer"
): Promise<{
  provider: AIProvider;
  providerType: ResolvedRepositoryConfigType["ai"]["provider"]["type"];
}> {
  loadRepoEnv(repoRoot);
  const repositoryConfig = getRepositoryConfig(repoRoot);
  const configuredProvider = repositoryConfig.ai.provider;
  const defaultProvider = {
    type: "openai" as const,
  };
  const environment = readProviderEnvironment();
  const workflowProfileName = repositoryConfig.ai.roles[workflowRole];
  const workflowModel =
    workflowProfileName !== undefined
      ? repositoryConfig.ai.profiles[workflowProfileName]?.model
      : undefined;

  try {
    return {
      provider: await createProviderFromConfig(configuredProvider, environment, {
        modelOverride: workflowModel,
      }),
      providerType: configuredProvider.type,
    };
  } catch (error: unknown) {
    const configuredMessage = error instanceof Error ? error.message : String(error);

    if (configuredProvider.type === defaultProvider.type) {
      throw new Error(configuredMessage);
    }

    try {
      const provider = await createProviderFromConfig(defaultProvider, environment);
      console.log(
        `Configured provider "${configuredProvider.type}" is unavailable. ${configuredMessage} Falling back to the default provider "${defaultProvider.type}".`
      );
      return {
        provider,
        providerType: defaultProvider.type,
      };
    } catch (defaultError: unknown) {
      const defaultMessage =
        defaultError instanceof Error ? defaultError.message : String(defaultError);
      throw new Error(
        `Configured provider "${configuredProvider.type}" is unavailable. ${configuredMessage} The default provider "${defaultProvider.type}" is also unavailable. ${defaultMessage}`
      );
    }
  }
}

