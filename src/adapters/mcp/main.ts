#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApp } from "../composition.js";
import { createMcpServer } from "./server.js";

const app = createApp();
await createMcpServer(app).connect(new StdioServerTransport());
