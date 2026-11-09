import { describe, expect, it } from "vitest";
import { Approval } from "../src/domain/approval.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import { PathGuard } from "../src/domain/pathGuard.js";
import { Solution } from "../src/domain/solution.js";
import { TextNormalizer } from "../src/domain/textNormalizer.js";
import { UrlPolicy } from "../src/domain/urlPolicy.js";

describe("TextNormalizer", () => {
  const normalizer = new TextNormalizer();

  it("drops stop words and stems, so phrasing differences give the same hash", () => {
    expect(normalizer.hash("Add an endpoint for Orders")).toBe(normalizer.hash("add endpoint for order"));
  });

  it("keeps language names such as c# and .net intact", () => {
    expect(normalizer.terms("Upgrade C# code to .NET 10")).toEqual(["upgrade", "c#", "code", "net", "10"]);
  });
});

describe("Solution", () => {
  it("follows the lifecycle draft, evaluated, accepted", () => {
    const solution = Solution.propose("add endpoint", "Minimal endpoint", "diff");
    solution.moveTo("evaluated");
    solution.moveTo("accepted");
    expect(solution.isSuggestable).toBe(true);
  });

  it("refuses to skip evaluation", () => {
    const solution = Solution.propose("add endpoint", "Minimal endpoint", "diff");
    expect(() => solution.moveTo("accepted")).toThrow(/draft solution cannot become accepted/);
  });
});

describe("Approval", () => {
  it("runs an approved action once", () => {
    const approval = Approval.request("download", "dotnet-10-sdk", "needed");
    approval.approve("engineer");
    approval.consume("download");
    expect(() => approval.consume("download")).toThrow(/executed, not approved/);
  });

  it("cannot be used for another kind of action", () => {
    const approval = Approval.request("download", "x", "needed");
    approval.approve("engineer");
    expect(() => approval.consume("clone")).toThrow(/for a download/);
  });

  it("is decided once", () => {
    const approval = Approval.request("clone", "repo", "needed");
    approval.deny("engineer");
    expect(() => approval.approve("engineer")).toThrow(/already denied/);
  });
});

describe("PathGuard", () => {
  const guard = new PathGuard("/data/mirrors/repo");

  it("allows paths inside the root", () => {
    expect(guard.resolve("src/a.ts")).toContain("a.ts");
  });

  it.each(["../other/a.ts", "../../etc/passwd", "/etc/passwd"])("refuses %s", (p) => {
    expect(() => guard.resolve(p)).toThrow(/outside/);
  });
});

describe("UrlPolicy", () => {
  const policy = new UrlPolicy(["learn.microsoft.com"]);

  it("accepts an allowed https host", () => {
    expect(policy.check("https://learn.microsoft.com/en-us/dotnet").hostname).toBe("learn.microsoft.com");
  });

  it.each([
    ["http://learn.microsoft.com/x", /Only https/],
    ["https://evil.example.com/x", /not on the allow-list/],
    ["https://user:secret@learn.microsoft.com/x", /credentials/],
    ["not a url", /Not a valid URL/],
  ])("refuses %s", (url, message) => {
    expect(() => policy.check(url)).toThrow(message);
  });
});

describe("EvaluationResult", () => {
  it("caps the digest so it fits any context", () => {
    expect(new EvaluationResult("xunit", false, "x".repeat(5000)).digest.length).toBe(1024);
  });
});
