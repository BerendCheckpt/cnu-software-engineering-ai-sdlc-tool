#!/usr/bin/env node
import { createServer } from "node:http";
import { createApp } from "../composition.js";
import { FrontDoor } from "../frontdoor/index.js";
import { ChatGateway } from "./chatGateway.js";

// First, so the settings below can come from `.env`.
const app = createApp();
const upstream = process.env.AISDLC_UPSTREAM_URL;
if (!upstream) {
  console.error("Set AISDLC_UPSTREAM_URL in .env to the cnu-claude-agent base URL, for example http://localhost:8090.");
  process.exit(1);
}
// Localhost unless told otherwise: the front door answers from shared knowledge before any token is checked.
const host = process.env.AISDLC_GATEWAY_HOST ?? "127.0.0.1";
const port = Number(process.env.AISDLC_GATEWAY_PORT ?? 8091);

const gateway = new ChatGateway(new FrontDoor(app.lookup), upstream);
createServer((req, res) => void gateway.handle(req, res)).listen(port, host, () => {
  console.log(`[gateway] listening on http://${host}:${port}, forwarding to ${upstream}`);
});
