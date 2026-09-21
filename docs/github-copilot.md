# GitHub Copilot

Install the canonical Agent Skills pack:

```bash
prs skills install copilot
```

GitHub Copilot supports personal Agent Skills under `~/.agents/skills`. This is the same location used by the Codex adapter, so installing for both hosts shares one managed copy of each canonical file.

Copilot can select a skill automatically when the request matches its description. A portable explicit prompt is:

```text
Use the prs-issue agent skill to work on GitHub issue 329.
Use the prs-pr agent skill to prepare PR 88 for local testing.
Use the prs-pr agent skill to address comments on PR 88.
```

Copilot CLI also supports prompts such as `Use the /prs-issue skill to work on GitHub issue 329.` Other Copilot surfaces may expose skills differently, so PRS does not describe `/prs-issue` as a universal Copilot slash command.

The same six names are available: `prs`, `prs-create`, `prs-issue`, `prs-finish`, `prs-pr`, and `prs-orchestrate`. Copilot-specific discovery and invocation guidance stays in this adapter documentation; the shared skill bodies remain unchanged.

`prs-pr` uses the main checkout for readiness and the requested `review`, `resolve-conflicts`, `address-comments`, or `fix-tests` action. It supports PRs without linked issues and retains approval and guarded-push steps. See [the PR workflow](agent-workflows.md#existing-pull-requests).

The installer stores shared ownership and content hashes in `~/.agents/skills/.prs-managed-skills.json`. Re-running either the Codex or Copilot installer updates unchanged managed copies and preserves custom or modified files.

## Optional macOS app usage tracking

Run `prs skills install copilot` (or `prs skills install all`) interactively on macOS and accept the local usage-tracking prompt. The same prompt appears after choosing `copilot` or `all` in interactive `prs setup`. An empty answer declines; an existing enabled PRS configuration is preserved without prompting again. Skill installation can succeed even when telemetry setup subsequently fails; rerun the explicit enable/disable command to recover.

For scripts or an explicit choice:

```bash
prs skills install all --copilot-telemetry enable
prs setup --skills all --copilot-telemetry enable
```

These commands configure the user's macOS launch environment and install one PRS-owned personal `preToolUse` hook; they do not launch or restart Copilot, start model sessions, change authentication/permissions, or publish evidence. Fully quit the app and reopen it normally from the Dock after setup. Settings are applied immediately to future launchd processes and reapplied by three one-shot user LaunchAgents on future logins. Apps auto-started during login can race that setup; restart Copilot after login if it did not inherit the settings. This is not an app-exclusive preference: Copilot CLI and other future processes honoring these variables and personal hooks can inherit them too.

PRS manages only these values:

- `COPILOT_OTEL_FILE_EXPORTER_PATH`: `~/Library/Application Support/prs/copilot-usage/usage.jsonl` (stored as an absolute path).
- `COPILOT_OTEL_EXPORTER_TYPE`: `file`, so this setup uses local export rather than a network collector.
- `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`: `false`.

The private usage directory also holds version-2 `state.json` and short-lived binding files. The personal hook is `~/.copilot/hooks/prs-token-usage.json`; it directly invokes the internal PRS bridge without shell interpolation. It fires only for shell tools, and the bridge records a binding only when that tool is running the canonical Copilot token-capture command. The stored JSON contains only its schema version, exact session ID, canonical repository root, observation time, and fixed capture purpose—never prompts, responses, raw tool arguments, credentials, or message content. Bindings expire after 60 seconds and two fresh session IDs for one repository are treated as ambiguous.

The three job files are `~/Library/LaunchAgents/uk.devware.prs.copilot-usage.0.plist`, `.1.plist`, and `.2.plist`. PRS refuses conflicting existing launch-environment values, unowned/modified hook or job files, symlinked paths and non-private output or binding files. A valid version-1 managed state is migrated without replacing its usage log or changing launch-setting ownership. A failed activation leaves a `pending` recovery record. A stale `setup.lock` after an interrupted installer must only be removed after confirming no setup process is running.

To disable the PRS configuration:

```bash
prs skills install copilot --copilot-telemetry disable
```

Disable removes only the three verified PRS job files, the exact PRS-owned hook, and transient bridge bindings, and unsets matching environment values introduced by PRS. Compatible values that predated setup and subsequently changed values are preserved. Usage logs remain local and are not deleted. A changed or unowned hook/job is preserved and blocks enable or disable with recovery guidance. Restart Copilot afterward. `--copilot-telemetry skip` changes nothing. These options are also supported by `prs setup --skills copilot` and `--skills all`; other hosts reject them. Unsupported operating systems still install the skills but do not configure launch settings or hooks.

Configuration is tested offline; actual app export remains to be checked during normal issue work, not a billable smoke session. During an opted-in local Copilot app/CLI run, the bare capture command consumes a fresh managed session binding for the same repository and the verified managed exporter. Explicit `--session` and `--source` values remain authoritative. Missing, stale, invalid, or ambiguous state stays unavailable rather than selecting a recent session. The bridge cannot backfill telemetry from sessions that ran before export was enabled. The shared log is not rotated automatically, but Copilot JSONL capture reads it in fixed chunks only through the size observed at open, retains only matching chat records, rejects records above 8 MiB, and caps retained matches at 100,000. JSON arrays and other hosts retain the 64 MiB whole-file cap. Hosted Copilot coding-agent evidence remains unsupported. Reports remain selected-session checkpoints, not proof of full-task or subagent coverage. See [capture and reporting](usage-evidence.md#native-capture) for supported formats and coverage limits.
