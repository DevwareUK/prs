const owned = /^<!-- prs:(?:issue-spec|issue-plan|managed-issue|issue-migration|audit) -->/;
export function escapeMondayText(source: string): string {
    return source.replace(/[&<>"'\r]/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "\r": "&#13;" }[value]!)).replace(/\n/g, "<br />");
}
function unescapeText(source: string): string {
    return source.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, value => {
        const names: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
        if (names[value.toLowerCase()])
            return names[value.toLowerCase()];
        const n = value[2].toLowerCase() === "x" ? parseInt(value.slice(3, -1), 16) : Number(value.slice(2, -1));
        return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : value;
    });
}
export function encodeMondayMarkdown(markdown: string): string {
    if (!owned.test(markdown))
        throw new Error("Monday managed content requires a leading PRS marker.");
    return `<p>${escapeMondayText(markdown)}</p>`;
}
export function decodeMondayMarkdown(html: string): string | undefined {
    const match = /^<p>([\s\S]*)<\/p>$/.exec(html);
    if (!match)
        return undefined;
    const content = match[1].replace(/<br\s*\/?\s*>/gi, "\n");
    if (/[<>]/.test(content))
        return undefined;
    const decoded = unescapeText(content);
    return owned.test(decoded) ? decoded : undefined;
}
export function decodeFocalMirror(html: string, prefix: string): {
    body: string;
    sourceUrl: string;
} | undefined {
    const match = /^<p>([^<>]*)<br\s*\/?\s*><a href="(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*)">\2<\/a><\/p><p>([\s\S]*)<\/p>$/.exec(html);
    if (!match || !unescapeText(match[1]).startsWith(prefix))
        return undefined;
    const content = match[3].replace(/<br\s*\/?\s*>/gi, "\n");
    if (/[<>]/.test(content))
        return undefined;
    return { body: unescapeText(content), sourceUrl: match[2] };
}
