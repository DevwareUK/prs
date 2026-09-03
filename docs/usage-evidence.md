# Usage evidence (version 1)

PRS consumes local host-export envelopes; it does not collect private logs, launch models, fetch prices, or use provider credentials. Synthetic fixtures establish mappings, not compatibility with every native host version or provider invoices.

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
