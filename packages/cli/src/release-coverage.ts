import { ReleaseCoverageEvidence } from "@prs/contracts";

function scopeKey({ ecosystem, path }: { ecosystem: string; path: string }): string {
  return JSON.stringify([ecosystem, path]);
}

export function validateReleaseCoverage(input: unknown, now = Date.now()) {
  const parsed = ReleaseCoverageEvidence.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid release coverage evidence: ${details.join("; ")}`);
  }

  const { baseline, startedAt, inventoryGaps, lockfiles, observations } = parsed.data;
  const start = Date.parse(startedAt);
  if (start > now) throw new Error("The release coverage run start is in the future.");

  const inventory = new Map(lockfiles.map(lock => [scopeKey(lock), lock]));
  if (inventory.size !== lockfiles.length) throw new Error("Duplicate lockfile in release coverage inventory.");

  const releases = new Map<string, Extract<typeof observations[number], { kind: "release" }>>();
  const advisories: Extract<typeof observations[number], { kind: "advisory" }>[] = [];
  for (const observation of observations) {
    const key = scopeKey(observation);
    if (!inventory.has(key)) {
      throw new Error(`Observation for uninventoried ${observation.ecosystem} lockfile: ${observation.path}.`);
    }
    if (observation.kind === "advisory") {
      advisories.push(observation);
      continue;
    }
    if (releases.has(key)) throw new Error(`Duplicate release observation for ${observation.ecosystem} lockfile: ${observation.path}.`);
    releases.set(key, observation);
  }

  const coverage = lockfiles.map(lock => {
    const release = releases.get(scopeKey(lock));
    const gaps = [...(release?.gaps ?? [])];
    const addGap = (reason: string, detail: string) => gaps.push({ scope: lock.path, reason, detail });
    let verified: typeof release;

    if (!release) {
      addGap("missing-release-comparison", "No release comparison was supplied for this lockfile.");
    } else {
      const observed = Date.parse(release.observedAt);
      if (release.repository !== baseline.repository || release.revision !== baseline.revision) {
        addGap("baseline-mismatch", "The comparison is for a different repository or revision.");
      } else if (observed < start || observed > now) {
        addGap("stale-observation", "The comparison was observed outside the audit run.");
      } else if (release.sources.length === 0) {
        addGap("missing-release-source", "No release sources were recorded for this comparison.");
      } else {
        verified = release;
        if (lock.packageCount === null) {
          addGap("unknown-package-count", "The lockfile package count could not be established.");
        } else if (release.checkedCount !== lock.packageCount && gaps.length === 0) {
          addGap("unchecked-entries", `Compared ${release.checkedCount} of ${lock.packageCount} locked packages.`);
        }
      }
    }

    return {
      ...lock,
      status: gaps.length === 0 ? "complete" : "incomplete",
      comparison: release && { observedAt: release.observedAt, sources: release.sources, resultRef: release.resultRef },
      checkedCount: verified?.checkedCount ?? 0,
      gaps,
      findings: verified?.findings ?? [],
    };
  });

  const incomplete = inventoryGaps.length > 0 || coverage.some(lock => lock.status === "incomplete");
  return {
    version: 1,
    status: incomplete ? "incomplete" : coverage.length ? "complete" : "not-applicable",
    baseline,
    startedAt,
    inventoryGaps,
    lockfiles: coverage,
    advisories,
  };
}
