import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendMediaEvidenceSection,
  loadMediaEvidenceManifest,
  renderMediaEvidenceMarkdown,
  resolveRepositoryMediaEvidence,
} from "./media-evidence";

describe("media evidence", () => {
  it("loads URL and local media records and renders GitHub-friendly Markdown", () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-media-evidence-"));
    const screenshotPath = resolve(repoRoot, "screenshot.png");
    const manifestPath = resolve(repoRoot, "media.json");
    writeFileSync(screenshotPath, "png", "utf8");
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          media: [
            {
              url: "https://example.com/result.png",
              kind: "image",
              caption: "Verified result",
              alt: "Verified UI result",
            },
            {
              url: "https://example.com/demo.mp4",
              kind: "video",
              caption: "Demo recording",
            },
            {
              path: "screenshot.png",
              caption: "Original bug screenshot",
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );

    const evidence = loadMediaEvidenceManifest(repoRoot, manifestPath);
    expect(evidence).toMatchObject([
      {
        kind: "image",
        caption: "Verified result",
        source: { type: "url", value: "https://example.com/result.png" },
      },
      {
        kind: "video",
        caption: "Demo recording",
        source: { type: "url", value: "https://example.com/demo.mp4" },
      },
      {
        kind: "image",
        caption: "Original bug screenshot",
        source: { type: "local", value: "screenshot.png" },
      },
    ]);

    const markdown = renderMediaEvidenceMarkdown(evidence);
    expect(markdown).toContain("## Visual References");
    expect(markdown).toContain("![Verified UI result](https://example.com/result.png)");
    expect(markdown).toContain("[Demo recording](https://example.com/demo.mp4)");
    expect(markdown).toContain("Local image: `screenshot.png`");
    expect(markdown).toContain("not GitHub-visible");
  });

  it("rejects missing local media files before publication", () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-media-evidence-missing-"));
    const manifestPath = resolve(repoRoot, "media.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({ media: [{ path: "missing.png", caption: "Missing" }] }),
      "utf8"
    );

    expect(() => loadMediaEvidenceManifest(repoRoot, manifestPath)).toThrow(
      "Media file does not exist: missing.png"
    );
  });

  it("does not append duplicate media evidence sections", () => {
    const evidence = [
      {
        kind: "image" as const,
        caption: "Reference dashboard hierarchy",
        alt: "Reference dashboard hierarchy",
        mimeType: "image/png",
        sizeBytes: 1_352_584,
        source: { type: "local" as const, value: "docs/app-home.png" },
      },
    ];
    const content = appendMediaEvidenceSection(
      "# Improve Dinner Bell home screen\n\n## Summary\nUse the visual reference.",
      evidence
    );

    const appended = appendMediaEvidenceSection(content, evidence);

    expect(appended.match(/## Visual References/g)).toHaveLength(1);
    expect(appended.match(/docs\/app-home\.png/g)).toHaveLength(1);
  });

  it("renders tracked repository image paths as raw GitHub URLs", () => {
    const evidence = [
      {
        kind: "image" as const,
        caption: "Dinner Bell home screen",
        alt: "Dinner Bell mobile home",
        mimeType: "image/png",
        sizeBytes: 1_352_584,
        source: { type: "local" as const, value: "docs/app-home.png" },
      },
    ];

    const resolved = resolveRepositoryMediaEvidence(evidence, {
      owner: "DevwareUK",
      repo: "prs",
      refName: "codex/issue-259-media",
      trackedPaths: ["docs/app-home.png"],
    });

    const markdown = renderMediaEvidenceMarkdown(resolved);
    expect(markdown).toContain(
      "![Dinner Bell mobile home](https://raw.githubusercontent.com/DevwareUK/prs/refs/heads/codex/issue-259-media/docs/app-home.png)"
    );
    expect(markdown).not.toContain("not GitHub-visible");
  });

  it("omits untracked local media from GitHub-facing Markdown", () => {
    const evidence = [
      {
        kind: "image" as const,
        caption: "Untracked screenshot",
        alt: "Untracked screenshot",
        mimeType: "image/png",
        sizeBytes: 100,
        source: { type: "local" as const, value: "tmp/screenshot.png" },
      },
    ];

    const resolved = resolveRepositoryMediaEvidence(evidence, {
      owner: "DevwareUK",
      repo: "prs",
      refName: "main",
      trackedPaths: [],
    });

    expect(renderMediaEvidenceMarkdown(resolved)).toBe("");
  });
});
