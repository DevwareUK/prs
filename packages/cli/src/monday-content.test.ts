import { expect, it } from "vitest";
import { encodeMondayMarkdown, decodeMondayMarkdown } from "./monday-content";
it.each(["<!-- prs:issue-spec -->\n\n# Spec\n\n```ts\na < b && c\n```", "<!-- prs:issue-plan -->\r\n\r\n**é** &amp; <b>literal</b>\r\n", "<!-- prs:managed-issue -->\n\n\n\"quoted\" 'apostrophe' 😀"])('preserves literal owned Markdown: %s', source => {
    expect(decodeMondayMarkdown(encodeMondayMarkdown(source))).toBe(source);
});
it("does not treat human discussion or executable HTML as owned Markdown", () => {
    expect(decodeMondayMarkdown('<p>A human comment</p>')).toBeUndefined();
    expect(decodeMondayMarkdown('<script><!-- prs:issue-plan --></script>')).toBeUndefined();
});
