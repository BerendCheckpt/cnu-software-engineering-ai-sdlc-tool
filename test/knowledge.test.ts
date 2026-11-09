import { beforeEach, describe, expect, it } from "vitest";
import { DecideApproval, RequestApproval } from "../src/application/approvals.js";
import { LookupSolutions } from "../src/application/lookupSolutions.js";
import { AcceptSuggestion, RejectSuggestion } from "../src/application/reviewSuggestion.js";
import { AcceptSolution, ProposeSolution, RecordApplication } from "../src/application/solutionLifecycle.js";
import { openDatabase } from "../src/infrastructure/sqlite/database.js";
import { SqliteApprovalStore } from "../src/infrastructure/sqlite/sqliteApprovalStore.js";
import { SqliteSolutionStore } from "../src/infrastructure/sqlite/sqliteSolutionStore.js";

describe("knowledge use cases", () => {
  let store: SqliteSolutionStore;
  let lookup: LookupSolutions;

  /** Proposes, evaluates and accepts a solution, as the real flow would. */
  function acceptedSolution(prompt: string, summary: string): string {
    const solution = new ProposeSolution(store).execute(prompt, summary, "diff --git a/x b/x");
    solution.moveTo("evaluated");
    store.save(solution);
    return new AcceptSolution(store).execute(solution.id).id;
  }

  beforeEach(() => {
    store = new SqliteSolutionStore(openDatabase(":memory:"));
    lookup = new LookupSolutions(store);
  });

  it("suggests an accepted solution for the same prompt worded differently", () => {
    const id = acceptedSolution("Add a minimal API endpoint for Orders", "Minimal API endpoint");
    const result = lookup.execute("add minimal api endpoint for order");
    expect(result.decision).toBe("suggest");
    expect(result.matches[0]?.solution.id).toBe(id);
    expect(result.matches[0]?.exact).toBe(true);
  });

  it("suggests on a close BM25 match", () => {
    const id = acceptedSolution("Add a minimal API endpoint for Orders with validation", "Minimal API endpoint");
    acceptedSolution("Write xunit tests for the pricing service", "Pricing tests");
    const result = lookup.execute("minimal API endpoint for orders with input validation");
    expect(result.decision).toBe("suggest");
    expect(result.matches[0]?.solution.id).toBe(id);
  });

  it("goes to a model when the overlap is too small", () => {
    acceptedSolution("Add a minimal API endpoint for Orders", "Minimal API endpoint");
    expect(lookup.execute("Refactor the Angular order list to signals").decision).toBe("model");
  });

  it("never suggests a draft", () => {
    new ProposeSolution(store).execute("Add a minimal API endpoint for Orders", "draft", "");
    expect(lookup.execute("Add a minimal API endpoint for Orders").matches).toHaveLength(0);
  });

  it("shows where a suggestion was applied", () => {
    const id = acceptedSolution("Add a minimal API endpoint for Orders", "Minimal API endpoint");
    new RecordApplication(store).execute({ solutionId: id, repository: "shop-api", commit: "abc123", files: ["Orders.cs"] });
    expect(lookup.execute("Add a minimal API endpoint for Orders").matches[0]?.applications[0]?.repository).toBe("shop-api");
  });

  it("adds an accepted suggestion to the implementation plan", () => {
    const id = acceptedSolution("Add a minimal API endpoint for Orders", "Minimal API endpoint");
    new AcceptSuggestion(store).execute(id, "Orders endpoint please");
    expect(store.plan("current").map((s) => s.id)).toEqual([id]);
  });

  it("turns a rejection into a session brief that carries the reason", () => {
    const id = acceptedSolution("Add a minimal API endpoint for Orders", "Minimal API endpoint");
    const brief = new RejectSuggestion(store, lookup).execute(id, "Add a minimal API endpoint for Orders", "We use controllers");
    expect(brief.toPrompt()).toContain("We use controllers");
    expect(brief.toPrompt()).toContain(id);
  });

  it("requires a reason to reject", () => {
    const id = acceptedSolution("Add endpoint", "Endpoint");
    expect(() => new RejectSuggestion(store, lookup).execute(id, "Add endpoint", " ")).toThrow(/Say why/);
  });
});

describe("approval use cases", () => {
  it("returns the same pending request when asked twice, and only a decision changes it", () => {
    const store = new SqliteApprovalStore(openDatabase(":memory:"));
    const request = new RequestApproval(store);
    const first = request.execute("download", "dotnet-10-sdk", "migration needs it");
    expect(request.execute("download", "dotnet-10-sdk", "again").id).toBe(first.id);

    new DecideApproval(store).approve(first.id, "engineer");
    expect(store.get(first.id)?.status).toBe("approved");
    expect(store.pending()).toHaveLength(0);
  });
});
