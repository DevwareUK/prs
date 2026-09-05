import { manageCopilotAppTelemetry, type CopilotTelemetryOptions, type CopilotTelemetryResult } from "./copilot-app-telemetry";
import type { CopilotTelemetryAction } from "./skill-install-options";

export async function offerCopilotTelemetry(input: {
  action?: CopilotTelemetryAction; interactive: boolean;
  promptForLine: (prompt: string) => Promise<string>; options?: CopilotTelemetryOptions;
}): Promise<CopilotTelemetryResult> {
  if (input.action === "skip" || (!input.action && !input.interactive)) return { status: "skipped", message: "Copilot telemetry unchanged. Opt in with --copilot-telemetry enable." };
  if (input.action) return manageCopilotAppTelemetry(input.action, input.options);
  const current = manageCopilotAppTelemetry("status", input.options);
  if (current.status === "enabled" || current.status === "unsupported") return current;
  const answer = (await input.promptForLine("Enable local usage tracking for the Copilot app? This adds macOS login settings for local-only export, disables content capture, and also affects Copilot CLI/future processes. Restart the app afterward. [y/N]: ")).trim().toLowerCase();
  if (answer === "yes" || answer === "y") return manageCopilotAppTelemetry("enable", input.options);
  if (answer !== "" && answer !== "n" && answer !== "no") throw new Error("Choose yes or no for Copilot app usage tracking");
  return { status: "skipped", message: "Copilot telemetry unchanged. Opt in later with --copilot-telemetry enable." };
}
