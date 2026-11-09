import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch, parse } from "../src/adapters/cli/dispatch.js";
import { InteractiveShell, tokenize } from "../src/adapters/cli/shell.js";
import { type App, appPaths, createApp } from "../src/adapters/composition.js";
import { tempDir } from "./helpers.js";

describe("tokenize", () => {
  it("splits on spaces, keeps quoted text together and leaves Windows paths alone", () => {
    expect(tokenize(`propose --prompt "add an endpoint" --summary 'Orders API' --diff-file C:\\work\\a.diff`))
      .toEqual(["propose", "--prompt", "add an endpoint", "--summary", "Orders API", "--diff-file", "C:\\work\\a.diff"]);
    expect(tokenize('reject 1 --reason ""')).toEqual(["reject", "1", "--reason", ""]);
    expect(tokenize("   ")).toEqual([]);
    expect(() => tokenize('lookup "half')).toThrow(/Missing closing "/);
  });
});

describe("the interactive session", () => {
  let app: App;
  let home: string;

  beforeEach(() => {
    home = tempDir();
    cpSync(path.resolve("config"), path.join(home, "config"), { recursive: true });
    app = createApp(appPaths(home), {
      cleanup: {
        sandbox: { ensureAvailable: async () => {} }, restorer: { restore: async () => {} }, formatters: [],
        gates: { forRun: () => ({ evaluators: [], findingSources: [], release: async () => undefined }) },
      },
    });
  });

  afterEach(() => app.close());

  async function session(lines: string[]): Promise<{ output: string; shell: InteractiveShell }> {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => { text += String(chunk); });
    const shell = new InteractiveShell(app, input, output, { terminal: false, historyFile: app.paths.history });
    input.end(`${lines.join("\n")}\n`);
    await shell.run();
    return { output: text, shell };
  }

  it("remembers the repo and the solution, fills them in, and asks y/N for a human decision", async () => {
    const pending = app.requestApproval.execute("download", "dotnet-10-compat", "for the migration");
    const { output, shell } = await session([
      "use repo shop",
      'propose --prompt "add an endpoint" --summary Endpoint',
      "context",
      "deny", "n",
      "deny", "y",
      "approve",
      "revise",
      'lookup "half',
      "nonsense",
      "exit",
      "context",
    ]);

    const solution = /draft ([0-9a-f-]{36})/.exec(output)?.[1];
    expect(solution).toBeDefined();
    expect(shell.context).toEqual({ repo: "shop", solution });
    expect(output).toContain(`repo: shop\nsolution: ${solution}`);
    expect(output).toContain(`deny download dotnet-10-compat: for the migration? [y/N] `);
    expect(output).toContain("Nothing was changed.");
    expect(app.approvals.get(pending.id)?.status).toBe("denied");
    expect(output).toContain("Nothing waits for approval.");
    expect(output).toContain("--diff-file is required.");
    expect(output).toContain('Missing closing ".');
    expect(output).toContain("Unknown command nonsense.");
    // `use` and `context` each show the context once; the `context` after exit never runs.
    expect(output.match(/repo: shop/g)).toHaveLength(2);
    // readline keeps history only for a real terminal, so a piped session leaves no history file behind.
    expect(existsSync(app.paths.history)).toBe(false);
  });

  it("names the approvals when more than one is open", async () => {
    const first = app.requestApproval.execute("download", "a", "one");
    app.requestApproval.execute("download", "b", "two");
    const { output } = await session(["approve"]);
    expect(output).toContain("Several approvals are open; name one:");
    expect(output).toContain(first.id);
  });

  it("completes commands, subcommands, options and remembered values", async () => {
    const { shell } = await session(["use run 1a2b3c4d"]);
    expect(shell.complete("cle")).toEqual([["cleanup"], "cle"]);
    expect(shell.complete("cleanup ch")).toEqual([["check"], "ch"]);
    expect(shell.complete("eval --re")[0]).toContain("--repo");
    expect(shell.complete("cleanup check 1a")).toEqual([["1a2b3c4d"], "1a"]);
  });
});

describe("dispatch", () => {
  it("refuses a human decision without a person at the terminal", async () => {
    const home = tempDir();
    cpSync(path.resolve("config"), path.join(home, "config"), { recursive: true });
    const app = createApp(appPaths(home));
    try {
      const { command, args } = parse(["reopen", "some-id"]);
      await expect(dispatch(app, command!, args, undefined)).rejects.toThrow(/needs a person at an interactive terminal/);
    } finally {
      app.close();
    }
  });
});
