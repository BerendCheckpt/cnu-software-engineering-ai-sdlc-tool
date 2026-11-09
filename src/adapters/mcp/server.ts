import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DomainError } from "../../domain/errors.js";
import type { App } from "../composition.js";
import { TextRenderer } from "../render.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * The eight tools a model gets (ADR 0002). Descriptions are one line because they are sent with every request.
 * There is deliberately no tool to decide an approval, accept a solution or reopen an escalated one: those are
 * human decisions (ADR 0004, ADR 0010).
 */
export function createMcpServer(app: App, renderer = new TextRenderer()): McpServer {
  const server = new McpServer({ name: "aisdlc", version: "0.1.0" });

  server.registerTool("find_solutions", {
    description: "Find accepted solutions for a task, with their test results and where they were applied.",
    inputSchema: { prompt: z.string().min(3).max(2000) },
  }, ({ prompt }) => run(() => renderer.matches(app.lookup.execute(prompt).matches)));

  server.registerTool("search_docs", {
    description: "Search the local official documentation. Returns at most 5 sections.",
    inputSchema: {
      query: z.string().min(2).max(300),
      framework: z.string().max(40).optional(),
      version: z.string().max(20).optional(),
    },
  }, ({ query, framework, version }) => run(() => renderer.chunks(app.searchDocs.execute(query, framework, version))));

  server.registerTool("search_code", {
    description: "Search a mirrored repository for identifiers. Returns at most 5 lines.",
    inputSchema: { repository: z.string().max(100), query: z.string().min(2).max(200) },
  }, ({ repository, query }) => run(async () => renderer.locations(await app.browseCode.search(repository, query))));

  server.registerTool("read_snippet", {
    description: "Read at most 40 lines of a file in a mirrored repository.",
    inputSchema: {
      repository: z.string().max(100),
      path: z.string().max(500),
      startLine: z.number().int().min(1),
      endLine: z.number().int().min(1),
    },
  }, ({ repository, path, startLine, endLine }) =>
    run(() => app.browseCode.read(repository, path, startLine, endLine)));

  server.registerTool("request_approval", {
    description: "Ask the engineer to approve downloading a doc (target: source id) or cloning a repo (target: https URL).",
    inputSchema: {
      kind: z.enum(["download", "clone"]),
      target: z.string().max(500),
      reason: z.string().min(3).max(300),
    },
  }, ({ kind, target, reason }) => run(() => {
    if (kind === "clone") return `${renderer.approval(app.requestClone.execute(target, reason))}. Wait for the engineer.`;
    const result = app.requestDocs.execute(target, reason);
    if (result.kind === "present") return `${target} is already available; use search_docs.`;
    if (result.kind === "unknown") return `${target} has no known official source. Tell the engineer; do not continue.`;
    return `${renderer.approval(result.approval)}. Wait for the engineer.`;
  }));

  server.registerTool("propose_solution", {
    description: "Save your solution as a draft for evaluation and human review. diff is a unified diff.",
    inputSchema: {
      prompt: z.string().min(3).max(2000),
      summary: z.string().min(3).max(300),
      diff: z.string().max(200_000),
    },
  }, ({ prompt, summary, diff }) => run(() => {
    const solution = app.proposeSolution.execute(prompt, summary, diff);
    return `draft solution ${solution.id} saved. Evaluate it with run_evaluations.`;
  }));

  server.registerTool("run_evaluations", {
    description: "Run the tests and SonarQube on a draft. Fix every issue it lists, then revise_solution and run it again.",
    inputSchema: { solutionId: z.string().max(100), repository: z.string().max(100) },
  }, ({ solutionId, repository }) => run(async () =>
    renderer.evaluation(solutionId, repository, await app.evaluateSolution.execute(solutionId, repository))));

  server.registerTool("revise_solution", {
    description: "Replace a draft's diff with your fixed version. diff is the whole change as a unified diff.",
    inputSchema: { solutionId: z.string().max(100), diff: z.string().max(200_000) },
  }, ({ solutionId, diff }) => run(() => {
    const solution = app.reviseSolution.execute(solutionId, diff);
    return `draft ${solution.id} revised. Run run_evaluations again.`;
  }));

  return server;
}

/** Domain errors go back to the model as a readable tool error; anything else is reported without internals. */
async function run(work: () => string | Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await work() }] };
  } catch (error) {
    const text = error instanceof DomainError ? error.message : `Tool failed: ${(error as Error).message.split("\n")[0]}`;
    return { content: [{ type: "text", text }], isError: true };
  }
}
