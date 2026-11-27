---
name: prs-update-audit
description: Use when asked to audit dependency, toolchain, CI or runtime updates in a PRS-configured project or run its authorized update-audit schedule.
---

# Audit project updates

Resolve the repository from the requested checkout and PRS configuration. Record its repository identity, authoritative source ref and commit, and the requested mode. Use the project's documented baseline or the current configured base ref. Confirm the revision is current or record the freshness gap. Use repository instructions for approved inventory checks, ownership, exclusions, and evidence of production or scheduled coverage.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available. Otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

## Discover and verify

1. Inventory tracked manifests and locks across the project and its workspaces. Include direct and relevant transitive dependencies from standard package managers such as npm, pnpm, Yarn, Composer, pip/uv, Bundler, Cargo and Go. Inspect toolchain pins and selectors, CI action refs, Dockerfiles, Compose and other deployment manifests for release tags and digests. Trace generated files and aliases back to the file that owns the pin.
2. Record the installed, locked or deployed version and its source per component. A manifest range, mutable tag, or CI selector alone does not establish the resolved or deployed version. Use repository-documented runtime checks when available. Keep platform-specific queries such as Drupal Update Status in project guidance. Record explicit gaps for unsupported sources, unknown deployed versions, unreachable sources, unresolved pins and excluded components.
3. Compare each tracked lockfile with current authoritative upstream registries, release notes or signed release metadata as described under Release coverage. Check vendor or ecosystem advisories independently. Match advisory ranges and affected configuration to the selected project's observed versions. Record the applicable fixed version on a supported line, compatibility constraints, upstream URLs, and the evidence date. Keep uncertain applicability or an unavailable safe target visible as unresolved. Use only the evidence needed to identify and remediate the affected dependency.
4. Check `prs tool issue list --json`, `prs tool pr list --json`, and `prs tool issue context <number> --json` for relevant issues and their linked PRs. Inspect exact component, version or advisory, affected locations, target and acceptance scope. Where open lists are insufficient, use repository-scoped GitHub reads to find recent closed or merged work and verify what reached the baseline. Confirm scheduled coverage from the current schedule and its actual work scope. Record preparation and deployment statuses separately, with evidence for each. A schedule name, matching title or unavailable result is insufficient. Treat gaps in duplicate or coverage checks as unresolved for affected candidates.
5. Rank confirmed security fixes ahead of routine updates. Use this order and select the highest applicable label per issue.
   - `security:critical`
   - `security:high`
   - `security:medium`
   - `security:low`
   - `security:unrated` for a confirmed fix whose upstream advisory has no published rating.

   For Drupal, map Highly Critical to Critical, Critical to High, Moderately Critical to Medium, and Less Critical or Not Critical to Low. Keep the original rating and score when published, advisory URLs, observed affected versions and fixed targets in the issue. Routine updates receive no severity label.
6. Group routine updates that share compatibility, owner, validation and release path. Keep major migrations, distinct rollouts or recovery requirements, and security work needing a separate delivery path independently reviewable. Follow project ownership rules. Record an acceptance check for the version change and a project-specific verification or rollout check.

## Release coverage

Record the UTC audit start before discovery. Build the lockfile inventory from the selected revision independently of release results so a failed or omitted comparison still has an inventory row. Inventory every detected ecosystem and every tracked lockfile or equivalent resolved package list. Record inventory gaps where the resolved package list is missing or the inventory cannot be established. Use the same evidence contract across ecosystems, including unsupported and private sources.

For each lockfile, make a fresh release comparison in this audit run. Include direct and relevant transitive pins, counting each inventoried entry according to the same scope used for the comparison. Record the package count, checked count, source URLs, observation time, and reference to the saved results or lookup failure. List entries or scopes left unchecked, excluded or unavailable. Record advisory checks separately. Advisory results, runtime reports, schedules and comparisons from earlier invocations do not satisfy release coverage. Use current runtime and schedule evidence to annotate candidates and verify applicability.

Save version-1 JSON in the run directory. Use `baseline` with `repository`, `ref` and full Git `revision`, and `startedAt` for the recorded audit start. Populate `lockfiles` with `ecosystem`, repo-relative `path` and `packageCount` (null if unknown). Each `observation` in the `observations` array identifies the same ecosystem and path, its `kind` (release or advisory), `repository`, `revision`, `observedAt`, `sources`, `resultRef`, `checkedCount` and `gaps`. Gaps have `scope`, `reason` and `detail`; use `inventoryGaps` for gaps outside an inventoried lockfile. Release observations include `findings` with package, locked version, target version, status (compatible, held or scheduled) and evidence. Consolidate all release sources for one lockfile in one observation. See the [evidence format and example](https://github.com/DevwareUK/prs/blob/main/docs/cli-reference.md#package-release-coverage) for exact field names.

Run `prs audit validate-coverage --file .prs/runs/<run>/release-coverage.json --json` before reporting coverage or preparing any publication packet. Keep the report with the run evidence. Report coverage as incomplete for every missing, stale, failed, unsupported or partially checked scope, while retaining verified findings elsewhere. If the input cannot be validated, resolve the error or report release coverage as incomplete. For a partial audit, prepare backlog items only from verified evidence and report the remaining gaps.

## Prepare the backlog

For each actionable item, prepare an H1-titled issue draft, an issue-specific specification and plan, and the desired label change. For an existing issue, capture its number and URL and show the exact amendment and any managed comment changes. Preserve unrelated issue text, labels and relationships. Include component and pin locations, source version and provenance, proposed target with upstream evidence, compatibility, owner, acceptance checks and material gaps. Group items by intended delivery, keeping one issue per unit of work.

Use a stable issue marker such as `<!-- prs:update-audit:<key> -->` in newly drafted bodies. Derive the key from the component or delivery group, affected pin scope and advisory or update line so a repeated run can find the same work. Look up the marker and semantic coverage, including pre-existing issues without a marker. Keep stable titles for open work. Confirm that any matching title belongs to the same backlog item because PRS can reuse an open issue by title. Resolve unrelated title collisions in the packet before publication. Keep volatile fields such as the audit timestamp and receipt path in local evidence so identical findings produce identical issue text.

## Interactive publication

Use the unified approval workflow in `prs-create` for new issues and `prs-issue` refinement for existing artifacts. Show one complete packet with the repository, exact drafts, specifications, plans, existing-issue amendments, and requested label changes or definitions. Obtain one explicit user approval of the exact packet and targets before any remote write. Present a complete revised packet for fresh approval if content or targets change.

## JDI publication

An explicit `prs-update-audit --jdi` request or an authorized saved schedule containing that invocation for a named project authorizes publication of the verified backlog in that selected project. Verify the scheduled project binding against the checkout and PRS repository identity. A generic schedule, bare audit or another workflow's JDI mode supplies no update-audit authorization.

Prepare and self-review the same packet. Record the originating request or saved schedule, execution mode, repository identity, run files, and exact issue targets or new issue keys. This authorization covers verified issue creation, scoped issue amendments, both managed comments and necessary severity label definitions and assignments. A different project requires its own authorization. Leave implementation, merging, deployment and schedule changes to their respective workflows.

## Publish and reconcile

1. Validate the selected repository, enabled issue tracker and available PR evidence. Keep files under the run directory and confirm each artifact is non-empty and matches the authorized packet. Keep unrelated labels intact. Preflight the current label definitions and create a missing requested severity label only when an authorized issue needs it. Use the approved definition with `gh label create <name> --repo <owner/repo> --color <hex> --description <description>`. Read back the label after an uncertain creation result. Preserve existing definitions.
2. Immediately before a write, refresh the relevant issue and PR state. Compare the desired body, managed comments and labels to GitHub. Skip every matching write. Resolve any conflicting change before editing and keep an identical rerun free of remote writes. Reconcile any pending attempt for the same project and issue key before creating work. Avoid overlapping publication runs for the same project.
3. Create each new issue individually so labels apply only to that issue. Record the attempt and intended key before sending it, then record the returned issue number, URL and managed-comment results.
   ```bash
   prs tool issue create --draft-file <draft> --spec-file <spec> --plan-file <plan> --label <severity> --json
   ```
   Omit `--label <severity>` for routine work. If the command returns an existing issue, verify its identity and reconcile its body and labels by number. If the create response is lost, look up the stable marker and exact issue scope in live GitHub before retrying. If the previous write cannot be resolved, report it as unresolved and retain the attempt instead of issuing another create.
4. Apply only authorized body amendments and per-issue label additions or removals using repository-scoped GitHub operations such as `gh issue edit <number> --repo <owner/repo> --body-file <body>` and `gh issue edit <number> --repo <owner/repo> --add-label <label>` or `--remove-label <label>`. Remove superseded labels from the five supported severity labels when needed. Preserve all other labels. Confirm that direct GitHub operations use the configured identity. PRS account selection is not inherited by direct `gh` commands. Follow the router's credential-store recovery instructions.
5. Publish missing or changed managed artifacts on the known issue number. Use this command for an authorized existing issue or to recover a partial creation. Compare both comments with the desired Markdown before calling it. The command republishes the pair in place when either comment is missing or differs.
   ```bash
   prs tool issue publish-artifacts <number> --spec-file <spec> --plan-file <plan> --json
   ```
6. Use `prs tool issue context <number> --json` to verify the specification and plan against the reviewed files, accounting for the managed marker and surrounding whitespace. Check both `<!-- prs:issue-spec -->` and `<!-- prs:issue-plan -->`. Read the issue body and labels from GitHub, including labels via `gh issue view <number> --repo <owner/repo> --json labels`. Verify the authorized amendment, requested severity assignment or removal, and preservation of unrelated labels. A creation or publication response alone does not establish completion.

Keep a local receipt of the authorized packet, issue keys, known numbers and URLs, and each write and verification result. On partial failure retain the original files and known targets, refresh live state and retry only pending operations within the original authorization. An interactive packet change requires fresh approval. Report created, updated, already covered and unresolved items with issue URLs, verified comment and label outcomes, and coverage gaps.
