import { cpSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMANDS } from "../src/adapters/cli/commands.js";
import { type App, appPaths, createApp } from "../src/adapters/composition.js";
import { FileDocArchive } from "../src/infrastructure/docs/fileDocArchive.js";
import { openDatabase } from "../src/infrastructure/sqlite/database.js";
import { SqliteDocStore } from "../src/infrastructure/sqlite/sqliteDocStore.js";
import { FrontDoor } from "../src/adapters/frontdoor/index.js";
import { createMcpServer } from "../src/adapters/mcp/server.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import { gitRepo, tempDir } from "./helpers.js";

type TextResult = { content: { type: string; text: string }[]; isError?: boolean };

describe("adapters", () => {
  let app: App;
  let client: Client;

  beforeEach(async () => {
    const home = tempDir();
    cpSync(path.resolve("config"), path.join(home, "config"), { recursive: true });
    gitRepo(path.join(home, "mirrors"), "shop-api", { "src/Orders.cs": "public class OrdersEndpoint {}\n" });
    const passingGate = { kind: "xunit" as const, evaluate: async () => new EvaluationResult("xunit", true, "3/3 passed") };
    app = createApp(appPaths(home), { evaluators: [passingGate] });

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(app).connect(serverSide);
    client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
  });

  afterEach(async () => {
    await client.close();
    app.close();
  });

  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as TextResult;

  it("offers exactly eight tools, and none that decides an approval", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "find_solutions", "propose_solution", "read_snippet", "request_approval", "revise_solution", "run_evaluations", "search_code",
      "search_docs",
    ]);
    // Tool definitions are sent with every request; keep them short.
    expect(tools.every((t) => (t.description ?? "").length <= 120)).toBe(true);
  });

  it("refuses to read outside a mirror", async () => {
    const result = await call("read_snippet", { repository: "shop-api", path: "../../config/sources.yaml", startLine: 1, endLine: 5 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/outside/);
  });

  it("searches code in a mirror", async () => {
    const result = await call("search_code", { repository: "shop-api", query: "OrdersEndpoint" });
    expect(result.content[0]?.text).toBe("src/Orders.cs:1: public class OrdersEndpoint {}");
  });

  it("lets a model ask for a download but only leaves it pending", async () => {
    const result = await call("request_approval", { kind: "download", target: "dotnet-10-sdk", reason: "need SDK notes" });
    expect(result.content[0]?.text).toMatch(/download dotnet-10-sdk \(pending\)/);
    expect(app.approvals.pending()).toHaveLength(1);
  });

  it("tells a model to stop when a doc has no official source", async () => {
    const result = await call("request_approval", { kind: "download", target: "cobol-85", reason: "migration" });
    expect(result.content[0]?.text).toMatch(/no known official source/);
  });

  it("refuses a clone from a host that is not allowed", async () => {
    const result = await call("request_approval", { kind: "clone", target: "https://evil.example.com/x.git", reason: "need it" });
    expect(result.isError).toBe(true);
  });

  it("saves a proposal as a draft that the front door does not suggest", async () => {
    await call("propose_solution", { prompt: "Add an orders endpoint", summary: "Orders endpoint", diff: "" });
    expect(new FrontDoor(app.lookup).route("Add an orders endpoint").kind).toBe("model");
  });

  it("evaluates through MCP, and after a human accepts, the front door answers without a model", async () => {
    const proposed = await call("propose_solution", {
      prompt: "Add a minimal API endpoint for Orders", summary: "Orders endpoint", diff: "" });
    const id = /draft solution (\S+)/.exec(proposed.content[0]!.text)![1]!;

    const evaluated = await call("run_evaluations", { solutionId: id, repository: "shop-api" });
    expect(evaluated.content[0]?.text).toContain("xunit: passed - 3/3 passed");
    expect(evaluated.content[0]?.text).toMatch(/report: .*report\.md/);

    app.acceptSolution.execute(id); // the human step; not reachable through MCP
    const decision = new FrontDoor(app.lookup).route("add minimal API endpoint for orders");
    expect(decision.kind).toBe("suggestion");
    if (decision.kind === "suggestion") expect(decision.reply).toContain("xunit: passed");
  });

  it("reindexes downloaded docs from the CLI with the boilerplate headings of config/noise.yaml", async () => {
    const docs = COMMANDS.find((c) => c.name === "docs")!;
    const reindex = () => docs.run(app, { positionals: ["reindex"], options: {} });
    expect(await reindex()).toBe("No downloaded docs to reindex.");

    const source = app.sources.find("dotnet-10-compat")!;
    new FileDocArchive(app.paths.docs).write(source, "## Cryptography\n\nText.\n\n## Feedback\n\nRate this page.");
    const db = openDatabase(app.paths.database);
    new SqliteDocStore(db).replaceChunks(source, []);
    db.close();
    expect(await reindex()).toBe("dotnet-10-compat: 1 sections");
  });
});
