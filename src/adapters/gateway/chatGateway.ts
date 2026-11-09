import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import type { FrontDoor } from "../frontdoor/index.js";

const MAX_BODY_BYTES = 25 * 1024 * 1024;
// Longer than any deadline a caller sends; the benchmark allows 10 minutes per message.
const UPSTREAM_TIMEOUT_MS = 15 * 60_000;

export type Route = "front-door" | "model" | "passthrough";

interface ChatBody {
  message?: unknown;
  sessionId?: unknown;
  attachments?: unknown;
  [key: string]: unknown;
}

/**
 * Serves cnu-claude-agent's own `POST /chat` contract in front of it, unchanged in shape (ADR 0007).
 * A new, text-only conversation passes the front door first: a confident match is answered here with zero model
 * tokens, anything else is forwarded with the short brief as its message. Every other request is forwarded as is.
 */
export class ChatGateway {
  private readonly upstream: URL;

  constructor(
    private readonly frontDoor: FrontDoor,
    upstreamUrl: string,
    private readonly log: (line: string) => void = (line) => console.log(line),
  ) {
    this.upstream = new URL(upstreamUrl);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://gateway");
      if (req.method !== "POST" || url.pathname !== "/chat") return this.forward(req, res, undefined);

      const raw = await this.readBody(req);
      const body = this.parse(raw);
      if (!this.hasBearer(req) || !body || !this.isNewTextConversation(body)) {
        return this.forward(req, res, raw, "passthrough");
      }

      const decision = this.routeSafely(String(body.message));
      if (decision?.kind === "suggestion") return this.answer(res, url.searchParams.get("stream") === "1", decision.reply);

      const forwarded = decision ? Buffer.from(JSON.stringify({ ...body, message: decision.brief })) : raw;
      return this.forward(req, res, forwarded, decision ? "model" : "passthrough");
    } catch (error) {
      this.fail(res, 502, `gateway: ${(error as Error).message}`);
    }
  }

  /** The front door only judges the opening message of a conversation; a follow-up belongs to its session. */
  private isNewTextConversation(body: ChatBody): boolean {
    const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
    return typeof body.message === "string" && body.message.trim() !== "" && !body.sessionId && !hasAttachments;
  }

  /** A broken knowledge store must not take the agent down with it: fall back to forwarding the original. */
  private routeSafely(message: string): ReturnType<FrontDoor["route"]> | undefined {
    try {
      return this.frontDoor.route(message);
    } catch (error) {
      this.log(`[gateway] front door failed, forwarding unchanged: ${(error as Error).message}`);
      return undefined;
    }
  }

  /** Answers in the upstream's own shapes, so callers and the benchmark parser need no change. */
  private answer(res: ServerResponse, streaming: boolean, reply: string): void {
    const result = { sessionId: "", costUsd: 0, turns: 0, reply, route: "front-door" as Route };
    this.log(`[gateway] route=front-door chars=${reply.length}`);
    if (!streaming) {
      res.writeHead(200, { "content-type": "application/json", "x-aisdlc-route": "front-door" });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream", "cache-control": "no-cache", "x-aisdlc-route": "front-door" });
    res.write(`event: delta\ndata: ${JSON.stringify({ type: "delta", text: reply })}\n\n`);
    res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
    res.end();
  }

  /** Streams the upstream response back byte for byte. The token is passed on and never logged. */
  private forward(req: IncomingMessage, res: ServerResponse, body: Buffer | undefined, route?: Route): Promise<void> {
    const target = new URL(req.url ?? "/", this.upstream);
    const headers = { ...req.headers, host: target.host };
    if (body) headers["content-length"] = String(body.length);
    if (route) this.log(`[gateway] route=${route} ${req.method} ${target.pathname}`);

    return new Promise((resolve) => {
      const client = target.protocol === "https:" ? https : http;
      const upstream = client.request(target, { method: req.method, headers }, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, {
          ...upstreamRes.headers, ...(route ? { "x-aisdlc-route": route } : {}) });
        upstreamRes.pipe(res);
        upstreamRes.on("end", resolve);
      });
      upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => upstream.destroy(new Error("upstream did not answer in time")));
      upstream.on("error", (error) => {
        this.fail(res, 502, `upstream: ${error.message}`);
        resolve();
      });
      // A caller that goes away stops the agent upstream too, so nobody pays for tokens nobody reads.
      res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
      if (body) upstream.end(body);
      else req.pipe(upstream);
    });
  }

  private hasBearer(req: IncomingMessage): boolean {
    return /^Bearer\s+\S+/i.test(req.headers.authorization ?? "");
  }

  private parse(raw: Buffer): ChatBody | undefined {
    try {
      const value: unknown = JSON.parse(raw.toString("utf8"));
      return value && typeof value === "object" ? (value as ChatBody) : undefined;
    } catch {
      return undefined;
    }
  }

  private async readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) throw new Error("request body too large");
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  private fail(res: ServerResponse, status: number, message: string): void {
    this.log(`[gateway] ${message}`);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}
