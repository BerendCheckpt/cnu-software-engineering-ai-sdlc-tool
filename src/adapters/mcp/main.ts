import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApp } from "../composition.js";
import { createMcpServer } from "../helpers/mcp/createMcpServer.js";

const app = createApp();
await createMcpServer(app).connect(new StdioServerTransport());
