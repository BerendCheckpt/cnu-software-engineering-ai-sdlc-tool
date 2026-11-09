#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { TerminalProgress } from "../../infrastructure/progress/progress.js";
import { type App, createApp } from "../composition.js";
import { dispatch, parse, usage, type Ask } from "./dispatch.js";
import { InteractiveShell } from "./shell.js";

/** Asks once on the terminal, for a single command such as `aisdlc approve <id>`. */
const askOnce: Ask = async (question) => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
};

/** `aisdlc watch [<session>]`: prints a session's steps so far, then each new one, until Ctrl+C. */
async function watch(app: App, given: string | undefined): Promise<number> {
  const session = given ?? app.sessionLog.latest();
  if (!session) {
    console.error("No sessions yet. Name one: aisdlc watch <session>");
    return 1;
  }
  console.log(`Watching ${session} (${app.sessionLog.file(session)}). Ctrl+C to stop.`);
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  await app.sessionLog.follow(session, (line) => console.log(line), stop.signal);
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  // `aisdlc --session <name>` on its own names the session of the whole interactive shell.
  const shellSession = argv.length === 2 && argv[0] === "--session" ? argv[1] : undefined;
  if (argv.length === 0 || shellSession) {
    if (!interactive) {
      console.log(usage());
      return 0;
    }
    const app = createApp();
    try {
      await new InteractiveShell(app, process.stdin, process.stdout,
        { terminal: true, historyFile: app.paths.history, cwd: process.cwd(), ...(shellSession ? { session: shellSession } : {}) }).run();
      return 0;
    } finally {
      app.close();
    }
  }

  const { command, args } = parse(argv);
  if (!command || command === "help") {
    console.log(usage());
    return 0;
  }
  const app = createApp();
  if (command === "watch") {
    try {
      return await watch(app, args.positionals[0]);
    } finally {
      app.close();
    }
  }
  // Each step shows up live on stderr while the command runs; the result goes to stdout.
  app.progress.attach(new TerminalProgress(process.stderr));
  try {
    console.log((await dispatch(app, command, args, interactive ? askOnce : undefined, process.cwd())).text);
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  } finally {
    app.close();
  }
}

process.exitCode = await main();
