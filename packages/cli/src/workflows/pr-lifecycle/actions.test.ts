import { describe, expect, it } from "vitest";
import {
  getPrLifecycleActionMetadata,
  normalizePrLifecycleAction,
  PR_LIFECYCLE_ACTIONS,
} from "./actions";

describe("pr lifecycle actions", () => {
  it("defines canonical PR lifecycle actions with stable internal step names", () => {
    expect(PR_LIFECYCLE_ACTIONS).toEqual([
      "review",
      "prepare-review",
      "resolve-conflicts",
      "address-comments",
      "fix-tests",
      "add-tests",
      "push-reviewed",
      "ready",
      "publish-review",
    ]);

    expect(getPrLifecycleActionMetadata("address-comments")).toMatchObject({
      action: "address-comments",
      publicCommand: "address-comments",
      internalStep: "pr-fix-comments",
    });
    expect(getPrLifecycleActionMetadata("fix-tests")).toMatchObject({
      action: "fix-tests",
      publicCommand: "fix-tests",
      internalStep: "pr-fix-failing-tests",
    });
    expect(getPrLifecycleActionMetadata("add-tests")).toMatchObject({
      action: "add-tests",
      publicCommand: "add-tests",
      internalStep: "pr-fix-tests",
    });
  });

  it("normalizes compatibility aliases to canonical lifecycle actions", () => {
    expect(normalizePrLifecycleAction("fix-comments")).toBe("address-comments");
    expect(normalizePrLifecycleAction("fix-failing-tests")).toBe("fix-tests");
    expect(normalizePrLifecycleAction("address-comments")).toBe("address-comments");
    expect(normalizePrLifecycleAction("prepare-review")).toBe("prepare-review");
    expect(normalizePrLifecycleAction(undefined)).toBeUndefined();
    expect(normalizePrLifecycleAction("checkout")).toBeUndefined();
  });
});
