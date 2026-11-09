import { cpSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type App, appPaths, createApp } from "../src/adapters/composition.js";
import { FrontDoor } from "../src/adapters/frontdoor/index.js";
import { ChatGateway } from "../src/adapters/gateway/chatGateway.js";
import { EvaluationResult } from "../src/domain/evaluation.js";
import { gitRepo, tempDir } from "./helpers.js";

interface Received { url: string; authorization?: string; body: Record<string, unknown> }

/** Stands in for cnu-claude-agent: records the request and answers in its SSE shape. */
function fakeAgent(received: Received[]): Server {
  return createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    received.push({ url: req.url!, authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : {} });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`event: tool\ndata: ${JSON.stringify({ type: "tool", tool: "Read" })}\n\n`);
    res.end(`event: result\ndata: ${JSON.stringify({ sessionId: "s1", costUsd: 0.01, turns: 3, reply: "from model" })}\n\n`);
  });
}

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () =>
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

/** The same reading as benchmarking-local-models' parseSse. */
function events(text: string): { event: string; data: Record<string, unknown> }[] {
  return text.split(/\r?\n\r?\n/).filter(Boolean).map((block) => ({
    event: /^event:\s*(.+)$/m.exec(block)?.[1] ?? "message",
    data: JSON.parse(/^data:\s*(.+)$/m.exec(block)?.[1] ?? "null"),
  }));
}

describe("ChatGateway", () => {
  let app: App;
  let received: Received[];
  let agent: Server;
  let gateway: Server;
  let gatewayUrl: string;

  beforeEach(async () => {
    const home = tempDir();
    cpSync(path.resolve("config"), path.join(home, "config"), { recursive: true });
    gitRepo(path.join(home, "mirrors"), "shop-api", { "README.md": "shop\n" });
    const passingGate = { kind: "xunit" as const, evaluate: async () => new EvaluationResult("xunit", true, "3/3 passed") };
    app = createApp(appPaths(home), { evaluators: [passingGate] });

    received = [];
    agent = fakeAgent(received);
    const chat = new ChatGateway(new FrontDoor(app.lookup), await listen(agent), () => {});
    gateway = createServer((req, res) => void chat.handle(req, res));
    gatewayUrl = await listen(gateway);
  });

  afterEach(() => {
    gateway.close();
    agent.close();
    app.close();
  });

  /** An empty token sends no Authorization header. */
  const post = (body: Record<string, unknown>, query = "?stream=1", token = "user-token") =>
    fetch(`${gatewayUrl}/chat${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it("answers a known request itself, in the agent's SSE shape, with no model call", async () => {
    await acceptOrdersSolutionDirectly(app);
    const response = await post({ message: "add minimal API endpoint for orders" });
    const parsed = events(await response.text());

    expect(response.headers.get("x-aisdlc-route")).toBe("front-door");
    expect(parsed.map((e) => e.event)).toEqual(["delta", "result"]);
    expect(parsed[1]?.data).toMatchObject({ turns: 0, costUsd: 0, route: "front-door" });
    expect(String(parsed[1]?.data.reply)).toContain("Orders endpoint");
    expect(received).toHaveLength(0);
  });

  it("forwards an unknown request with the brief as its message, and streams the answer back", async () => {
    const response = await post({ message: "Refactor the Angular order list to signals", env: "qa" });
    const parsed = events(await response.text());

    expect(response.headers.get("x-aisdlc-route")).toBe("model");
    expect(received[0]?.url).toBe("/chat?stream=1");
    expect(received[0]?.authorization).toBe("Bearer user-token");
    expect(received[0]?.body).toMatchObject({ env: "qa" });
    expect(String(received[0]?.body.message)).toMatch(/^Task: Refactor the Angular order list to signals/);
    expect(parsed.map((e) => e.event)).toEqual(["tool", "result"]);
  });

  it("leaves follow-ups in a session untouched", async () => {
    await acceptOrdersSolutionDirectly(app);
    await (await post({ message: "add minimal API endpoint for orders", sessionId: "s1" })).text();
    expect(received[0]?.body.message).toBe("add minimal API endpoint for orders");
  });

  it("leaves messages with attachments untouched", async () => {
    await (await post({ message: "what is wrong here", attachments: [{ fileName: "a.png" }] })).text();
    expect(received[0]?.body.message).toBe("what is wrong here");
  });

  it("answers nothing from knowledge without a bearer token; the agent refuses it as before", async () => {
    await acceptOrdersSolutionDirectly(app);
    await (await post({ message: "add minimal API endpoint for orders" }, "?stream=1", "")).text();
    expect(received).toHaveLength(1);
    expect(received[0]?.authorization).toBeUndefined();
  });

  it("answers the non-streaming contract too", async () => {
    await acceptOrdersSolutionDirectly(app);
    const body = await (await post({ message: "add minimal API endpoint for orders" }, "")).json();
    expect(body).toMatchObject({ turns: 0, route: "front-door" });
  });

  it("passes other routes through", async () => {
    await fetch(`${gatewayUrl}/chat/other`, { method: "POST", body: "{}" });
    expect(received[0]?.url).toBe("/chat/other");
  });
});

/** One accepted solution, through the real flow: propose, evaluate with a passing gate, a human accepts. */
async function acceptOrdersSolutionDirectly(app: App): Promise<void> {
  const id = app.proposeSolution.execute("Add a minimal API endpoint for Orders", "Orders endpoint", "").id;
  await app.evaluateSolution.execute(id, "shop-api");
  app.acceptSolution.execute(id);
}
