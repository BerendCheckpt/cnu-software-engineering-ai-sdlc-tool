import { describe, expect, it } from "vitest";
import { TextRenderer } from "../src/adapters/classes/render/TextRenderer.js";
import { Solution } from "../src/domain/classes/solution/Solution.js";

describe("TextRenderer", () => {
  it("shows where a matched solution was applied: short sha, files and PR", () => {
    const solution = Solution.propose("upgrade to net10", "bump the target framework", "diff");
    const text = new TextRenderer().match({
      solution, overlap: 1, relevance: 0, exact: true, evaluations: [],
      applications: [{
        solutionId: solution.id, repository: "shop", commit: "0123456789abcdef",
        files: ["src/a.cs", "src/b.cs"], pullRequestUrl: "https://example.test/pr/1",
      }],
    });
    expect(text).toContain("  applied: shop@01234567 src/a.cs, src/b.cs https://example.test/pr/1");
  });
});
