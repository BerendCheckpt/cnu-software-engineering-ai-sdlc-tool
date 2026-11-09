import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnvFile } from "../src/infrastructure/config/envFile.js";
import { tempDir } from "./helpers.js";

describe("loadEnvFile", () => {
  it("sets the file's values over the environment, skips empty ones, and returns names only", () => {
    const file = path.join(tempDir(), ".env");
    writeFileSync(file, "# comment\nSONAR_HOST_URL=http://localhost:9000\nSONAR_TOKEN=new-token\nAISDLC_GATEWAY_PORT=\n");
    const env: NodeJS.ProcessEnv = { SONAR_TOKEN: "stale", AISDLC_GATEWAY_PORT: "9999" };

    expect(loadEnvFile(file, env)).toEqual(["SONAR_HOST_URL", "SONAR_TOKEN"]);
    expect(env).toEqual({ SONAR_HOST_URL: "http://localhost:9000", SONAR_TOKEN: "new-token", AISDLC_GATEWAY_PORT: "9999" });
  });

  it("does nothing without a file", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(loadEnvFile(path.join(tempDir(), ".env"), env)).toEqual([]);
    expect(env).toEqual({});
  });
});
