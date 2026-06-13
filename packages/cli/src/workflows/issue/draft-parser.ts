export function parseIssueDraftDocument(content: string): { title: string; body: string } {
  const lines = content.split(/\r?\n/);
  const titleLineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (titleLineIndex === -1 || !lines[titleLineIndex].startsWith("# ")) {
    throw new Error(
      "Issue draft must start with a top-level markdown heading like `# Issue title`."
    );
  }

  const title = lines[titleLineIndex].slice(2).trim();
  const body = lines.slice(titleLineIndex + 1).join("\n").trim();

  if (!title) {
    throw new Error("Issue draft title cannot be empty.");
  }

  if (!body) {
    throw new Error("Issue draft body cannot be empty.");
  }

  return {
    title,
    body,
  };
}

export function extractMarkdownSection(body: string, heading: string): string | undefined {
  const lines = body.trim().split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${heading}\\s*$`, "i");
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (startIndex === -1) {
    return undefined;
  }

  const remainingLines = lines.slice(startIndex + 1);
  const nextHeadingIndex = remainingLines.findIndex((line) =>
    /^##\s+/.test(line.trim())
  );
  const sectionLines =
    nextHeadingIndex === -1
      ? remainingLines
      : remainingLines.slice(0, nextHeadingIndex);
  const sectionBody = sectionLines.join("\n").trim();
  return sectionBody.length > 0 ? sectionBody : undefined;
}

export function extractOpeningParagraphs(body: string, maxParagraphs: number): string {
  const withoutHeadings = body
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s+/.test(line.trim()))
    .join("\n")
    .trim();
  const paragraphs = withoutHeadings
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs.slice(0, maxParagraphs).join("\n\n");
}

export function buildIssueSummaryBodyFromDraftBody(body: string): string {
  const summary =
    extractMarkdownSection(body, "Summary") ??
    extractMarkdownSection(body, "Context") ??
    extractOpeningParagraphs(body, 2);
  const lines = [
    "## Summary",
    "",
    summary || "See the managed issue specification comment for the settled scope.",
    "",
    "The settled specification and implementation plan are maintained in managed issue comments.",
  ];

  return lines.join("\n").trim();
}
