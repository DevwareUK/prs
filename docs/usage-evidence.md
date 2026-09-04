# Usage evidence (version 1)

PRS can capture allowlisted usage metadata from one selected native session file or local telemetry export, or consume manually supplied host-export envelopes. It does not search transcript contents, launch models, fetch prices, or use provider credentials. Synthetic fixtures establish mappings, not compatibility with every native host version or provider invoices.

## Native capture

Create or reuse a task-specific directory beneath `.prs/runs`, then start capture immediately:

```text
prs tool token-usage capture --host <codex|claude-code|copilot> --output .prs/runs/<run>/usage-evidence.json --json
```

Repeat with the same output before rendering. First capture defaults to now, excluding earlier work in a reused session. For retrospective capture, supply `--since <ISO-8601-with-offset>` with a known task-start time on the first call. Selection is by response observation/completion timestamp, strictly after the start and through the checkpoint; it is not an exact request-start or billing window. The last assistant response is emitted after its own capture call, so a later checkpoint is needed to include it.

The output binds the host, session, source and start time. Repeated calls retain those values, deduplicate response IDs and update growing Claude output counters. Binding changes, conflicting counters, lost responses, malformed complete JSON records and backwards checkpoints fail without replacing existing evidence. An incomplete final JSONL write is excluded with a partial warning. Use a separate artifact for a different session; do not sum reports that cover the same work. Keep the original artifact across issue/PR readiness handoffs even if the readiness run directory changes. Manually supplied evidence is not overwritten. Existing rate cards are retained.

Capture requires an existing real run directory and a regular source file no larger than 64 MiB. Source-file symlinks and aliased outputs are rejected. A per-output lock prevents simultaneous writers; after an interrupted process, inspect that no capture is running before removing its `.lock` file. Unknown usage remains unavailable/partial, never zero.

### Host connection

| Host | Session and source | Supported capture |
| --- | --- | --- |
| Codex | `--session` or `PRS_USAGE_SESSION_ID`, otherwise `CODEX_THREAD_ID`. `--source` or `PRS_USAGE_SOURCE`; otherwise exact session filename beneath `CODEX_HOME/sessions` (default native home). Multiple matches require an explicit path. | `token_usage_record` per-response `usage`, with matching `session_meta.id` and `turn_context` model. Legacy cumulative `token_count` and goal counters are not added. Nonzero cache-write semantics are not yet validated and are rejected. |
| Claude Code | `--session` / `PRS_USAGE_SESSION_ID` and `--source` / `PRS_USAGE_SOURCE` from native session metadata. An exact `<session>.jsonl` filename beneath the native `.claude/projects` directory can also be resolved. | Assistant transcript `message.usage`, deduplicated by `message.id`, or OTLP JSON `api_request` logs with matching `session.id`. Sidechain transcript records are excluded with a warning. |
| Copilot | `--session` / `PRS_USAGE_SESSION_ID` and `--source` / `PRS_USAGE_SOURCE`, otherwise `COPILOT_OTEL_FILE_EXPORTER_PATH`. Enable the local exporter before the native session; PRS does not enable it. | OTLP JSON chat spans or individual exported span records, with matching `gen_ai.conversation.id`. Parent `invoke_agent` spans and metric snapshots are not added. |

Use an explicitly known session ID, never the newest file or a guessed ID. For Claude Code, SessionStart hook input provides `session_id` and `transcript_path`; an existing user-managed hook can expose these as `PRS_USAGE_SESSION_ID` and `PRS_USAGE_SOURCE` through `CLAUDE_ENV_FILE`. This is optional setup, not a hook installed by PRS. For Copilot, configure `COPILOT_OTEL_FILE_EXPORTER_PATH` in the launching environment and pass the exact native session ID to capture. Keep content capture disabled. See [Claude hooks](https://code.claude.com/docs/en/hooks), [Claude monitoring](https://code.claude.com/docs/en/monitoring-usage) and [Copilot CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) for native setup. Do not launch an extra session just to validate capture.

The capture output is normalized, version-1 evidence; raw prompts, tool results and transcript bodies are discarded. A private `capture.sourcePath` remains in the local artifact to retain its binding, but is omitted from the capture command's JSON summary and rendered Markdown. `capture` records host/session, format, start/checkpoint, warnings and status. A `captured` status means supported records were read, **not** that full-task/subagent coverage is proven. All reports label that limitation. Codex's recorded single-session probe validated its response mapping; Claude/Copilot adapters have offline coverage and await validation during real issue work.

Native `hostEstimatedCost` (Claude OTLP `cost_usd`) is displayed separately from sourced-rate estimates and provider-reported charges; it is not an invoice and is never added to either total. Copilot's supported span schema does not declare the currency of `github.copilot.cost`, so capture omits that amount with a warning rather than assuming USD; AI units are not converted into tokens or currency. Capture does not fetch rates or manufacture missing cache fields. Missing source/identity gives actionable unavailable evidence. Check that evidence on the next real issue rather than making billable validation calls.

## Render and publish

Put either complete JSON envelope below at `.prs/runs/example/usage-evidence.json`, then run:

```bash
prs tool token-usage render --file .prs/runs/example/usage-evidence.json --output .prs/runs/example/token-usage.md --json
```

Review warnings, exclusions, and pricing status. Publication is separate and explicitly approved:

```text
prs audit publish --issue <number> --file .prs/runs/example/token-usage.md --section token-usage
prs audit publish --pr <number> --file .prs/runs/example/token-usage.md --section token-usage
```

Do not publish the JSON result: it contains raw source evidence. Raw artifacts remain ignored under the selected run. Reusing evidence for an issue and PR does not create new usage.

## Minimal unavailable envelope

Use the actual run ID, host, timestamp, scope, and stable phase-attempt identity. Unavailable events need a reason and no numeric payload. They must not trigger extra model calls.

```json
{
  "version": 1, "kind": "usage-evidence", "runId": "example",
  "events": [{
    "eventId": "example:verify:1",
    "host": "codex",
    "adapter": { "name": "host-native", "version": 1 },
    "source": { "id": "active-task", "kind": "host" },
    "counterScopeId": "active-task",
    "observedAt": "2026-09-03T10:00:00Z",
    "workflow": { "runId": "example", "phase": "verify", "phaseAttemptId": "verify:1" },
    "measurementKind": "cumulative-snapshot",
    "unit": "model-tokens",
    "coverage": { "id": "task-work", "representationId": "active-task" },
    "status": "unavailable",
    "reason": "Native usage was not exposed by this host"
  }]
}
```

## Normalized tokens with a synthetic rate snapshot

This complete example uses invented rates, not current provider prices. Input buckets are non-overlapping; the 20 reasoning tokens are already within output. Expected model tokens: 1,150. Estimated cost: USD 0.00195.

```json
{
  "version": 1, "kind": "usage-evidence", "runId": "example",
  "events": [{
    "eventId": "example:request:1", "host": "codex",
    "adapter": { "name": "host-native", "version": 1 },
    "source": { "id": "synthetic-example", "kind": "fixture" },
    "counterScopeId": "request-stream",
    "observedAt": "2026-09-03T10:01:00Z",
    "workflow": { "runId": "example", "phase": "implement", "phaseAttemptId": "implement:1" },
    "measurementKind": "provider-request",
    "requestId": "request-1", "requestsDisjoint": true,
    "interval": { "start": "2026-09-03T10:00:00Z", "end": "2026-09-03T10:01:00Z", "phase": "implement" },
    "unit": "model-tokens",
    "coverage": { "id": "task-work", "representationId": "requests", "disjoint": true },
    "status": "tracked",
    "model": { "provider": "example", "name": "example-model" },
    "context": { "tier": "default" },
    "tokenSemantics": { "reasoning": "included-in-output" },
    "usage": {
      "uncachedInputTokens": 200, "cachedInputTokens": 800,
      "cacheWriteTokens": 50, "outputTokens": 100,
      "reasoningTokens": 20, "providerTotalTokens": 1150
    },
    "rateCardId": "example-rate"
  }],
  "rateCards": [{
    "id": "example-rate", "provider": "example", "model": "example-model", "currency": "USD",
    "effectiveAt": "2026-09-01T00:00:00Z", "retrievedAt": "2026-09-03T00:00:00Z",
    "sourceUrl": "https://example.com/prs-synthetic-rates",
    "contextTier": { "name": "default", "minTokens": 0 },
    "reasoningBilling": "included-in-output",
    "perMillion": { "uncachedInputTokens": 2, "cachedInputTokens": 0.5, "cacheWriteTokens": 3, "outputTokens": 10 }
  }]
}
```

## Contract and native mappings

The authoritative schemas are exported as `UsageEvidence`, `UsageEvent`, and `UsageRateCard` from `@prs/contracts`. Known objects are strict. Token/counter values are safe non-negative integers; credits/money are finite non-negative amounts. Timestamps are ISO 8601 with an offset.

Every event has a stable `eventId`, supported `host` (`codex`, `claude-code`, `copilot`), adapter name/version, source ID/kind, counter scope, observation time, workflow run/phase/attempt, measurement kind, unit, status, and coverage. Workflow may also identify agent, parent agent, and span. Provenance is not authority to add overlapping counters.

Tracked or partial events supply exactly one payload:

| Payload | Use |
| --- | --- |
| `usage` | Normalized model-token buckets; requires `tokenSemantics.reasoning` (`included-in-output` or `separate`). Unknown buckets are omitted, known absence is zero. Provider total is reconciliation evidence, never an additional bucket. |
| `value: { amount, unit }` | Named host counter, currency (three-letter code), credit unit, or informational entitlement. Credits may carry `conversion: { currency, perCredit, sourceUrl, effectiveAt, retrievedAt }`. |
| `native` | Supported version-1 local export below. Adapter name equals native format; host must agree. Unknown fields in `native.values` survive locally in `raw.native`. |

For native tokens, replace `usage` with this object and change adapter name to its format. Both cache inclusion flags and reasoning treatment are required:

```json
{
  "version": 1, "format": "codex-session",
  "inputIncludesCacheRead": true, "inputIncludesCacheWrite": false,
  "reasoning": "included-in-output",
  "values": {
    "input_tokens": 1000, "cached_input_tokens": 800,
    "cache_creation_input_tokens": 0, "output_tokens": 100,
    "reasoning_tokens": 20, "total_tokens": 1100
  }
}
```

These names define PRS's supported local envelope, not private host log formats:

| Format / host | Native mapping |
| --- | --- |
| `codex-session` / Codex | `input_tokens`, `cached_input_tokens`, `cache_creation_input_tokens`, `output_tokens`, `reasoning_tokens`, `total_tokens`. Host counters instead use `tokensUsed` plus explicit `unit`. |
| `claude-usage` / Claude Code | `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`, `thinking_tokens`, `total_tokens`. Inclusion flags determine subtraction. |
| `copilot-usage` / Copilot | Same token field names as the Codex envelope. Credits instead use `credits` plus `unit: "github-ai-credit"`; reported currency uses `charge` plus currency `unit`. |
| `legacy-counter` / Codex | `totalTokens` becomes a `legacy-unknown` host counter, never model tokens. |

Unknown versions or ambiguous native semantics fail. Missing token classes remain partial. Opaque `raw` fields are retained locally, not rendered.

### Conservative legacy wrapper

Start with the minimal envelope, set `status: "tracked"`, remove `reason`, and replace these fields:

```json
{
  "host": "codex",
  "adapter": { "name": "legacy-counter", "version": 1 },
  "measurementKind": "host-counter", "unit": "host-counter",
  "native": { "version": 1, "format": "legacy-counter", "values": { "totalTokens": 250 } }
}
```

This contributes 250 host-counter units and no model-token cost. PRS does not discover or heuristically migrate old files. Separately supplied trustworthy token-class evidence may support model-token pricing.

## Coverage and cumulative counters

- Use the same coverage `id` for overlapping work and different `representationId` values for session snapshots versus requests or parent versus child totals.
- Select one `authoritativeRepresentationId` for each overlapping group. Optional `parentRepresentationId` describes nesting within the group. Conflicting declarations, unknown references, and cycles fail.
- Independent coverage groups must all declare `disjoint: true` before contributing to a combined total. Different event or phase IDs alone do not prove disjointness.
- `scoped-delta` requires a half-open `interval: { start, end }`. Adjacent intervals can add; overlapping intervals cannot. Independent concurrent requests need stable request IDs and `requestsDisjoint: true`.
- `cumulative-snapshot` observations are ordered within host/source/scope/unit/model partitions. The initial `baseline: { observedAt, usage }` (or `value`) must precede the observation. Later snapshots use their predecessor; do not repeat an initial baseline on later snapshots.
- Without a baseline, `100 → 160` contributes 60, with the first 100 unattributed. With an explicit zero baseline it contributes 160, not 260.
- A decrease excludes the transition and begins a new segment. `reset: { segmentId, at, baseline: "zero" }` explicitly declares a reset; without zero the first post-reset value is unattributed. Only fields known at both endpoints are differenced.
- Phase changes do not reset counters. Cross-phase intervals are shared/unattributed unless coverage establishes attribution. Retries have their own attempt identity without duplicating earlier work.
- Stable-ID replays do not change totals. Conflicting accounting fields fail. Rendering is stateless: supply all observations for the run; GitHub comments are not an accounting input.

## Pricing, credits, and limitations

Supply immutable rate cards with IDs, provider/model, currency, effective/retrieval timestamps, source URL, context tier (inclusive min/max bounds), and applicable per-million rates. Contributions explicitly select a rate ID. Context-tier names must match; bounded tiers also require per-request context length. Cumulative usage cannot establish that length.

Use `expiresAt` for promotions. Evidence crossing an effective/expiry boundary is unpriced: supply independently scoped contributions with appropriate cards instead. There is no automatic historical splitting, default price, live pricing call, currency mixing, or invoice reconstruction.

Reasoning measurement and billing each declare included-in-output or separate treatment. Pricing rebuckets explicitly and never bills the same token twice. Missing applicable classes or rates produce visibly partial estimates. Unknown models/cards/tiers and unsupported total-only allocations are unpriced with reasons.

A total-only contribution may supply `allocation: { version: 1, description, provenance: { sourceUrl, retrievedAt }, usage }` with complete non-overlapping classes summing to its provider total. The allocation is displayed and applies only when the contribution matches that total; PRS does not silently scale a cumulative allocation to a different delta. There is no hidden input/output blend.

Estimated cost, reported currency charges, credit consumption, credit conversion, and plan entitlements stay separate. Subtotals retain completeness/exclusion metadata. Entitlements are informational and not summed. All-unavailable model usage has a null total, not zero. Fixture tests and static skill parity do not prove native-runtime behavior.
