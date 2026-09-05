import type { InstallableAgentHost } from "./agent-skills-installer";

export type SkillSelection = InstallableAgentHost | "all";
export type CopilotTelemetryAction = "enable" | "disable" | "skip";
export const SKILL_HOSTS: InstallableAgentHost[] = ["codex", "claude-code", "copilot"];
export function selectedSkillHosts(selection: SkillSelection | "none"): InstallableAgentHost[] {
  return selection === "none" ? [] : selection === "all" ? [...SKILL_HOSTS] : [selection];
}
export function telemetryAction(value: string | undefined): CopilotTelemetryAction {
  if (value !== "enable" && value !== "disable" && value !== "skip") throw new Error("--copilot-telemetry requires enable, disable or skip");
  return value;
}
export function assertTelemetrySelection(selection: string, action?: CopilotTelemetryAction): void {
  if (action && selection !== "copilot" && selection !== "all") throw new Error("--copilot-telemetry requires installing copilot or all skills");
}
