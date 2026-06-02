import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";

export type MediaEvidenceKind = "image" | "video";

export type MediaEvidence = {
  kind: MediaEvidenceKind;
  caption: string;
  alt: string;
  mimeType: string;
  sizeBytes?: number;
  source: {
    type: "local" | "url";
    value: string;
  };
};

const IMAGE_EXTENSIONS = new Map([
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const VIDEO_EXTENSIONS = new Map([
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
]);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function repoRelativePath(repoRoot: string, path: string): string {
  const relativePath = relative(repoRoot, path).split("\\").join("/");
  if (!relativePath || relativePath.startsWith("../") || relativePath === "..") {
    return path;
  }

  return relativePath;
}

function inferKindAndMime(source: string): { kind: MediaEvidenceKind; mimeType: string } {
  const extension = extname(new URL(source, "file:///").pathname).toLowerCase();
  const imageMimeType = IMAGE_EXTENSIONS.get(extension);
  if (imageMimeType) {
    return { kind: "image", mimeType: imageMimeType };
  }

  const videoMimeType = VIDEO_EXTENSIONS.get(extension);
  if (videoMimeType) {
    return { kind: "video", mimeType: videoMimeType };
  }

  throw new Error(
    `Unsupported media type for ${source}. Supported image types: png, jpg, jpeg, gif, webp. Supported video types: mp4, mov, webm.`
  );
}

function mimeTypeForKind(source: string, kind: MediaEvidenceKind): string {
  const inferred = inferKindAndMime(source);
  if (inferred.kind !== kind) {
    throw new Error(`Media kind "${kind}" does not match file type for ${source}.`);
  }

  return inferred.mimeType;
}

function fallbackCaption(source: string): string {
  return basename(source)
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Media evidence";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function rawGitHubUrl(input: {
  owner: string;
  repo: string;
  refName: string;
  path: string;
}): string {
  return [
    "https://raw.githubusercontent.com",
    encodeURIComponent(input.owner),
    encodeURIComponent(input.repo),
    encodePath(`refs/heads/${input.refName}`),
    encodePath(input.path),
  ].join("/");
}

function parseMediaEntry(repoRoot: string, entry: unknown, index: number): MediaEvidence {
  if (!isRecord(entry)) {
    throw new Error(`Media entry ${index + 1} must be an object.`);
  }

  const rawPath = typeof entry.path === "string" ? entry.path.trim() : undefined;
  const rawUrl = typeof entry.url === "string" ? entry.url.trim() : undefined;
  if (Boolean(rawPath) === Boolean(rawUrl)) {
    throw new Error(`Media entry ${index + 1} must provide exactly one of "path" or "url".`);
  }

  const rawKind = typeof entry.kind === "string" ? entry.kind.trim() : undefined;
  const kind =
    rawKind === undefined
      ? undefined
      : rawKind === "image" || rawKind === "video"
        ? rawKind
        : undefined;
  if (rawKind !== undefined && kind === undefined) {
    throw new Error(`Media entry ${index + 1} has unsupported kind "${rawKind}".`);
  }

  const caption =
    typeof entry.caption === "string" && entry.caption.trim()
      ? entry.caption.trim()
      : fallbackCaption(rawPath ?? rawUrl ?? "");
  const alt =
    typeof entry.alt === "string" && entry.alt.trim()
      ? entry.alt.trim()
      : caption;

  if (rawUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error(`Media URL is invalid: ${rawUrl}`);
    }

    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error(`Media URL must use http or https: ${rawUrl}`);
    }

    const inferred = kind
      ? { kind, mimeType: mimeTypeForKind(rawUrl, kind) }
      : inferKindAndMime(rawUrl);

    return {
      kind: inferred.kind,
      caption,
      alt,
      mimeType: inferred.mimeType,
      source: { type: "url", value: rawUrl },
    };
  }

  const localPath = rawPath as string;
  const resolvedPath = isAbsolute(localPath) ? localPath : resolve(repoRoot, localPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Media file does not exist: ${localPath}`);
  }

  const inferred = kind
    ? { kind, mimeType: mimeTypeForKind(localPath, kind) }
    : inferKindAndMime(localPath);
  const sizeBytes = statSync(resolvedPath).size;
  const maxBytes = inferred.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (sizeBytes > maxBytes) {
    throw new Error(
      `Media file exceeds ${inferred.kind} limit (${formatBytes(maxBytes)}): ${localPath}`
    );
  }

  return {
    kind: inferred.kind,
    caption,
    alt,
    mimeType: inferred.mimeType,
    sizeBytes,
    source: {
      type: "local",
      value: repoRelativePath(repoRoot, resolvedPath),
    },
  };
}

export function loadMediaEvidenceManifest(
  repoRoot: string,
  manifestPath: string
): MediaEvidence[] {
  const resolvedManifestPath = isAbsolute(manifestPath)
    ? manifestPath
    : resolve(repoRoot, manifestPath);
  if (!existsSync(resolvedManifestPath)) {
    throw new Error(`Media manifest does not exist: ${manifestPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolvedManifestPath, "utf8"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Media manifest is not valid JSON: ${message}`);
  }

  const rawMedia = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.media)
      ? parsed.media
      : undefined;
  if (!rawMedia) {
    throw new Error('Media manifest must be a JSON array or an object with a "media" array.');
  }

  return rawMedia.map((entry, index) => parseMediaEntry(repoRoot, entry, index));
}

export function writeMediaEvidenceFile(
  filePath: string,
  evidence: MediaEvidence[]
): void {
  writeFileSync(filePath, `${JSON.stringify({ media: evidence }, null, 2)}\n`, "utf8");
}

export function resolveRepositoryMediaEvidence(
  evidence: MediaEvidence[],
  options: {
    owner: string;
    repo: string;
    refName: string;
    trackedPaths: string[];
  }
): MediaEvidence[] {
  const trackedPaths = new Set(options.trackedPaths);
  return evidence.flatMap((item) => {
    if (item.source.type !== "local") {
      return [item];
    }

    if (!trackedPaths.has(item.source.value)) {
      return [];
    }

    return [
      {
        ...item,
        source: {
          type: "url" as const,
          value: rawGitHubUrl({
            owner: options.owner,
            repo: options.repo,
            refName: options.refName,
            path: item.source.value,
          }),
        },
      },
    ];
  });
}

function renderMediaItem(item: MediaEvidence): string[] {
  if (item.source.type === "url" && item.kind === "image") {
    return [`- **${item.caption}**`, `  ![${item.alt}](${item.source.value})`];
  }

  if (item.source.type === "url" && item.kind === "video") {
    return [
      `- **${item.caption}**`,
      `  [${item.caption}](${item.source.value})`,
      `  Type: ${item.mimeType}`,
    ];
  }

  const size = item.sizeBytes === undefined ? "" : `, ${item.sizeBytes} bytes`;
  return [
    `- **${item.caption}**`,
    `  Local ${item.kind}: \`${item.source.value}\` (${item.mimeType}${size}; not GitHub-visible unless separately uploaded).`,
  ];
}

export function renderMediaEvidenceMarkdown(
  evidence: MediaEvidence[],
  options: { heading?: string } = {}
): string {
  if (evidence.length === 0) {
    return "";
  }

  const heading = options.heading ?? "Visual References";
  return [
    `## ${heading}`,
    "",
    ...evidence.flatMap((item) => [...renderMediaItem(item), ""]),
  ].join("\n").trimEnd();
}

export function appendMediaEvidenceSection(
  content: string,
  evidence: MediaEvidence[],
  options: { heading?: string } = {}
): string {
  const mediaMarkdown = renderMediaEvidenceMarkdown(evidence, options);
  if (!mediaMarkdown) {
    return content;
  }

  const heading = options.heading ?? "Visual References";
  if (content.includes(`## ${heading}`)) {
    return content;
  }

  return `${content.trimEnd()}\n\n${mediaMarkdown}\n`;
}
