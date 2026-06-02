import type { AuditTarget } from "../forge";
import { parseIssueNumber } from "./issue";

export type AuditCommandOptions = {
  action: "publish";
  target: AuditTarget;
  filePath: string;
  sectionName: string;
  localRun?: string;
  mediaManifestFilePath?: string;
};

const AUDIT_PUBLISH_USAGE =
  "Usage: prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name> [--local-run <path>] [--media-manifest <path>]";

export function parseAuditCommandArgs(args: string[]): AuditCommandOptions {
  const auditArgs = args[0] === "audit" ? args.slice(1) : args;
  const subcommand = auditArgs[0];

  if (subcommand !== "publish") {
    throw new Error(AUDIT_PUBLISH_USAGE);
  }

  const optionArgs = auditArgs.slice(1);
  let target: AuditTarget | undefined;
  let filePath: string | undefined;
  let sectionName: string | undefined;
  let localRun: string | undefined;
  let mediaManifestFilePath: string | undefined;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const rawArg = optionArgs[index];

    if (rawArg === "--issue" || rawArg === "--pr") {
      if (target) {
        throw new Error("`prs audit publish` requires exactly one of --issue or --pr.");
      }

      target = {
        type: rawArg === "--issue" ? "issue" : "pull-request",
        number: parseIssueNumber(optionArgs[index + 1]),
      };
      index += 1;
      continue;
    }

    if (rawArg === "--file") {
      filePath = optionArgs[index + 1];
      if (!filePath) {
        throw new Error(AUDIT_PUBLISH_USAGE);
      }
      index += 1;
      continue;
    }

    if (rawArg === "--section") {
      sectionName = optionArgs[index + 1];
      if (!sectionName) {
        throw new Error(AUDIT_PUBLISH_USAGE);
      }
      index += 1;
      continue;
    }

    if (rawArg === "--local-run") {
      localRun = optionArgs[index + 1];
      if (!localRun) {
        throw new Error(AUDIT_PUBLISH_USAGE);
      }
      index += 1;
      continue;
    }

    if (rawArg === "--media-manifest") {
      mediaManifestFilePath = optionArgs[index + 1];
      if (!mediaManifestFilePath) {
        throw new Error(AUDIT_PUBLISH_USAGE);
      }
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--media-manifest=")) {
      mediaManifestFilePath = rawArg.slice("--media-manifest=".length);
      continue;
    }

    throw new Error(`Unknown audit option "${rawArg}".`);
  }

  if (!target) {
    throw new Error("`prs audit publish` requires exactly one of --issue or --pr.");
  }

  if (!filePath) {
    throw new Error(AUDIT_PUBLISH_USAGE);
  }

  if (!sectionName) {
    throw new Error(AUDIT_PUBLISH_USAGE);
  }

  return {
    action: "publish",
    target,
    filePath,
    sectionName,
    localRun,
    mediaManifestFilePath,
  };
}
