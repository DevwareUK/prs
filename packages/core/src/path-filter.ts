function escapeRegexCharacter(character: string): string {
  return /[\\^$+?.()|[\]{}]/.test(character) ? `\\${character}` : character;
}

export function normalizeRepositoryPath(filePath: string): string {
  const normalized = filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");

  return normalized === "." ? "" : normalized;
}

function compileGlobPattern(pattern: string): RegExp {
  const normalizedPattern = normalizeRepositoryPath(pattern);
  let expression = "^";

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];

    if (character === "*") {
      const nextCharacter = normalizedPattern[index + 1];
      if (nextCharacter === "*") {
        const followingCharacter = normalizedPattern[index + 2];
        if (followingCharacter === "/") {
          expression += "(?:.*\\/)?";
          index += 2;
          continue;
        }

        expression += ".*";
        index += 1;
        continue;
      }

      expression += "[^/]*";
      continue;
    }

    if (character === "?") {
      expression += "[^/]";
      continue;
    }

    expression += escapeRegexCharacter(character);
  }

  expression += "$";
  return new RegExp(expression);
}

type CompiledPathPattern = {
  regex: RegExp;
  matchBasenameOnly: boolean;
};

export function createRepositoryPathMatcher(patterns: readonly string[]): (filePath: string) => boolean {
  const compiledPatterns: CompiledPathPattern[] = patterns
    .map((pattern) => normalizeRepositoryPath(pattern))
    .filter(Boolean)
    .map((pattern) => ({
      regex: compileGlobPattern(pattern),
      matchBasenameOnly: !pattern.includes("/"),
    }));

  if (compiledPatterns.length === 0) {
    return () => false;
  }

  return (filePath: string): boolean => {
    const normalizedPath = normalizeRepositoryPath(filePath);
    const basename =
      normalizedPath.length === 0
        ? normalizedPath
        : normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);

    return compiledPatterns.some(({ regex, matchBasenameOnly }) =>
      regex.test(matchBasenameOnly ? basename : normalizedPath)
    );
  };
}

export function isRepositoryPathExcluded(
  filePath: string,
  excludePaths: readonly string[]
): boolean {
  return createRepositoryPathMatcher(excludePaths)(filePath);
}

export function filterRepositoryPaths(
  filePaths: readonly string[],
  excludePaths: readonly string[]
): string[] {
  const matchesExcludedPath = createRepositoryPathMatcher(excludePaths);
  return filePaths.filter((filePath) => !matchesExcludedPath(filePath));
}
