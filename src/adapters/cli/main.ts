#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { createApp } from "../composition.js";
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

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (argv.length === 0) {
    if (!interactive) {
      console.log(usage());
      return 0;
    }
    const app = createApp();
    try {
      await new InteractiveShell(app, process.stdin, process.stdout, { terminal: true, historyFile: app.paths.history, cwd: process.cwd() }).run();
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
