import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DecideApproval, RequestApproval } from "../src/application/approvals.js";
import { PullDocs, ReindexDocs, RequestDocs, SearchDocs } from "../src/application/docs.js";
import { BrowseCode, RequestClone, mirrorName } from "../src/application/repositories.js";
import { MarkdownChunker } from "../src/domain/markdownChunker.js";
import { FileDocArchive } from "../src/infrastructure/docs/fileDocArchive.js";
import { GitRepoMirror } from "../src/infrastructure/git/gitRepoMirror.js";
import { ExecFileRunner } from "../src/infrastructure/process/execFileRunner.js";
import { openDatabase } from "../src/infrastructure/sqlite/database.js";
import { SqliteApprovalStore } from "../src/infrastructure/sqlite/sqliteApprovalStore.js";
import { SqliteDocStore } from "../src/infrastructure/sqlite/sqliteDocStore.js";
import { DOTNET_10, FakeCatalog, FakeFetcher, gitRepo, tempDir } from "./helpers.js";

const PAGE = `# Breaking changes in .NET 10

Intro text.

## BinaryFormatter removed

BinaryFormatter is no longer available. Use System.Text.Json instead.

## Default trace context propagator

The default DistributedContextPropagator is now W3C.`;

describe("documentation", () => {
  let approvals: SqliteApprovalStore;
  let docs: SqliteDocStore;
  let catalog: FakeCatalog;
  let root: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(":memory:");
    approvals = new SqliteApprovalStore(db);
    docs = new SqliteDocStore(db);
    catalog = new FakeCatalog([DOTNET_10]);
    root = tempDir();
  });

  const request = () => new RequestDocs(catalog, docs, new RequestApproval(approvals));
  const pull = (fetcher: FakeFetcher) => new PullDocs(catalog, approvals, fetcher, new FileDocArchive(root), docs);

  it("downloads nothing until a human approves, then exactly once", async () => {
    const result = request().execute("dotnet-10-compat", "migration");
    if (result.kind !== "requested") throw new Error(`expected a request, got ${result.kind}`);
    const fetcher = new FakeFetcher(PAGE);

    await expect(pull(fetcher).execute(result.approval.id)).rejects.toThrow(/pending, not approved/);
    expect(fetcher.calls).toBe(0);

    new DecideApproval(approvals).approve(result.approval.id, "engineer");
    const pulled = await pull(fetcher).execute(result.approval.id);
    expect(pulled.chunks).toBe(3);
    await expect(pull(fetcher).execute(result.approval.id)).rejects.toThrow(/executed/);
    expect(fetcher.calls).toBe(1);
  });

  it("stores the page read-only", async () => {
    const result = request().execute("dotnet-10-compat", "migration");
    if (result.kind !== "requested") throw new Error("expected a request");
    new DecideApproval(approvals).approve(result.approval.id, "engineer");
    const { file } = await pull(new FakeFetcher(PAGE)).execute(result.approval.id);
    expect(file).toBe(path.join(root, "dotnet", "10", "dotnet-10-compat.md"));
    // On Windows only the write bit is honoured; on Linux the file is 0444.
    expect(statSync(file).mode & 0o222).toBe(0);
  });

  it("keeps the approval when the download fails, so it can be retried", async () => {
    const result = request().execute("dotnet-10-compat", "migration");
    if (result.kind !== "requested") throw new Error("expected a request");
    new DecideApproval(approvals).approve(result.approval.id, "engineer");
    await expect(pull(new FakeFetcher("", true)).execute(result.approval.id)).rejects.toThrow(/network down/);
    expect(approvals.get(result.approval.id)?.status).toBe("approved");

    // Asking again reuses the open approval instead of creating a duplicate, and approving again retries.
    const again = request().execute("dotnet-10-compat", "migration");
    expect(again.kind === "requested" && again.approval.id).toBe(result.approval.id);
    new DecideApproval(approvals).approve(result.approval.id, "engineer");
    expect((await pull(new FakeFetcher(PAGE)).execute(result.approval.id)).chunks).toBe(3);
  });

  it("reports a page outside the manifest as unknown, so a human decides", () => {
    expect(request().execute("cobol-85", "migration").kind).toBe("unknown");
  });

  it("splits archived pages again with the current rules, and keeps their download time", () => {
    const archive = new FileDocArchive(root);
    archive.write(DOTNET_10, PAGE);
    docs.replaceChunks(DOTNET_10, new MarkdownChunker().chunk(DOTNET_10, PAGE), "2026-11-01T00:00:00.000Z");
    const page = archive.read(DOTNET_10)!;
    expect(page.markdown).toBe(PAGE);

    const result = new ReindexDocs(catalog, archive, docs, new MarkdownChunker(["Default trace context propagator"])).execute();
    expect(result).toEqual({ reindexed: [{ id: "dotnet-10-compat", chunks: 2 }], notArchived: [], failed: [] });
    expect(docs.chunksOf("dotnet-10-compat").map((c) => c.heading))
      .toEqual(["Breaking changes in .NET 10", "BinaryFormatter removed"]);
    expect(db.prepare("SELECT fetched_at FROM doc_sources WHERE id = ?").get("dotnet-10-compat"))
      .toEqual({ fetched_at: page.fetchedAt });
  });

  it("reports an indexed page without an archive, and a page that fails, and goes on", () => {
    const other = { ...DOTNET_10, id: "dotnet-10-other", version: "10b" };
    const archive = new FileDocArchive(root);
    archive.write(other, PAGE);
    docs.replaceChunks(DOTNET_10, []);
    docs.replaceChunks(other, []);
    const failing = { chunk: () => { throw new Error("bad page"); } } as unknown as MarkdownChunker;

    expect(new ReindexDocs(new FakeCatalog([DOTNET_10, other]), archive, docs, failing).execute()).toEqual({
      reindexed: [], notArchived: ["dotnet-10-compat"], failed: [{ id: "dotnet-10-other", error: "bad page" }],
    });
  });

  it("reads an archived page without a header whole", () => {
    mkdirSync(path.join(root, "dotnet", "10"), { recursive: true });
    writeFileSync(path.join(root, "dotnet", "10", "dotnet-10-compat.md"), PAGE);
    expect(new FileDocArchive(root).read(DOTNET_10)?.markdown).toBe(PAGE);
  });

  it("finds the right section and bounds the result", async () => {
    docs.replaceChunks(DOTNET_10, new MarkdownChunker().chunk(DOTNET_10, PAGE));
    const hits = new SearchDocs(docs).execute("binaryformatter replacement");
    expect(hits[0]?.heading).toBe("BinaryFormatter removed");
    expect(hits.length).toBeLessThanOrEqual(5);
  });
});

describe("MarkdownChunker", () => {
  it("splits long sections at 60 lines", () => {
    const long = `# Title\n${Array.from({ length: 130 }, (_, i) => `line ${i}`).join("\n")}`;
    const chunks = new MarkdownChunker().chunk(DOTNET_10, long);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.content.split("\n").length <= 60)).toBe(true);
    expect(chunks[1]?.heading).toBe("Title (continued)");
  });
});

describe("repositories", () => {
  let root: string;
  let browse: BrowseCode;

  beforeEach(() => {
    root = tempDir();
    gitRepo(root, "shop-api", {
      "src/Orders.cs": "public class OrdersEndpoint\n{\n  // uses BinaryFormatter\n}\n",
      "src/Other.cs": "public class Other {}\n",
    });
    browse = new BrowseCode(new GitRepoMirror(root, new ExecFileRunner()));
  });

  it("finds code by identifier", async () => {
    const hits = await browse.search("shop-api", "BinaryFormatter");
    expect(hits).toEqual([{ path: "src/Orders.cs", line: 3, text: "// uses BinaryFormatter" }]);
  });

  it("reads at most 40 lines", async () => {
    const snippet = await browse.read("shop-api", "src/Orders.cs", 1, 500);
    expect(snippet.split("\n").length).toBeLessThanOrEqual(40);
    expect(snippet).toContain("1: public class OrdersEndpoint");
  });

  it("refuses to read outside the mirror", async () => {
    await expect(browse.read("shop-api", "../../secrets.txt", 1, 5)).rejects.toThrow(/outside/);
  });

  it("refuses a repository that is not mirrored, and says what to ask for", async () => {
    await expect(browse.search("unknown", "x")).rejects.toThrow(/its local folder \(aisdlc repo link <folder>\) or its git URL/);
  });

  it("checks a clone URL before a human is asked", () => {
    const approvals = new SqliteApprovalStore(openDatabase(":memory:"));
    const clone = new RequestClone(new FakeCatalog([]), new RequestApproval(approvals));
    expect(() => clone.execute("https://evil.example.com/x.git", "need it")).toThrow(/allow-list/);
    expect(clone.execute("https://github.com/checkpt-als/shop-api.git", "need it").status).toBe("pending");
  });

  it("names a mirror after the repository", () => {
    expect(mirrorName(new URL("https://github.com/checkpt-als/shop-api.git"))).toBe("shop-api");
  });

  it("checks out a writable copy for evaluation", async () => {
    const mirror = new GitRepoMirror(root, new ExecFileRunner());
    const destination = path.join(tempDir(), "workspace");
    await mirror.checkout("shop-api", destination);
    expect(existsSync(path.join(destination, "src", "Orders.cs"))).toBe(true);
  });
});
