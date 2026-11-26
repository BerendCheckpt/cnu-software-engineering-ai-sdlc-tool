import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { TerminalProgress } from "../../../infrastructure/classes/progress/TerminalProgress.js";
import { COMMANDS } from "../../constants/cli/COMMANDS.js";
import { OPTION_NAMES } from "../../constants/cli/OPTION_NAMES.js";
import { dispatch } from "../../helpers/cli/dispatch.js";
import { parse } from "../../helpers/cli/parse.js";
import { tokenize } from "../../helpers/cli/tokenize.js";
import { usage } from "../../helpers/cli/usage.js";
import type { ShellContext } from "../../interfaces/cli/ShellContext.js";
import type { ShellOptions } from "../../interfaces/cli/ShellOptions.js";
import type { App } from "../../types/composition/App.js";

const MAX_HISTORY = 500;

const SUBCOMMANDS: Record<string, string[]> = {
  docs: ["list", "request", "search", "reindex"],
  cleanup: ["analyze", "next", "check", "skip", "status", "finish"],
  repo: ["add", "link", "unlink", "list"],
  use: ["repo", "solution", "run", "session"],
};

const BUILT_INS = ["help", "use", "context", "exit", "quit"];

/** Commands whose first argument is a solution id. */
const SOLUTION_COMMANDS = new Set(["accept", "reject", "eval", "report", "solution-accept", "revise", "reopen", "crystallize"]);

/** Commands that name a mirror with `--repo`. */
const REPO_OPTION_COMMANDS = new Set(["eval", "migrate"]);

/** `cleanup` actions whose argument is a run id. */
const RUN_ACTIONS = new Set(["next", "check", "skip", "status", "finish"]);

/**
 * `aisdlc` on its own: one app for the whole session, the same commands, and a context that remembers the repo,
 * solution and clean-up run in use, so ids are not typed twice. Approvals are asked y/N here too.
 */
export class InteractiveShell {
  readonly context: ShellContext = {};
  private readonly rl: Interface;
  private readonly lines: AsyncIterator<string>;

  constructor(
    private readonly app: App,
    input: Readable,
    private readonly output: Writable,
    private readonly options: ShellOptions,
  ) {
    this.rl = createInterface({
      input, output, terminal: options.terminal, historySize: MAX_HISTORY,
      history: this.loadHistory(), completer: (line: string) => this.complete(line),
    });
    this.rl.on("SIGINT", () => {
      this.rl.write(null, { ctrl: true, name: "u" });
      this.output.write("\n");
      this.rl.prompt();
    });
    this.lines = this.rl[Symbol.asyncIterator]();
    if (options.session) this.context.session = options.session;
  }

  async run(): Promise<void> {
    this.print("aisdlc interactive session. Type help for the commands, exit to leave.");
    // Steps print here as they happen, so the person at this terminal sees the work live.
    const detach = this.app.progress.attach(new TerminalProgress(this.output));
    try {
      for (;;) {
        const line = await this.read(this.promptText());
        if (line === undefined) break;
        if (!(await this.handle(line))) break;
      }
    } finally {
      detach();
      this.saveHistory();
      this.rl.close();
    }
  }

  /** Runs one line; false when the session should end. */
  async handle(line: string): Promise<boolean> {
    let words: string[];
    try {
      words = tokenize(line);
    } catch (error) {
      this.print((error as Error).message);
      return true;
    }
    const [command, ...rest] = words;
    if (!command) return true;
    switch (command) {
      case "exit":
      case "quit":
        return false;
      case "help":
        this.print([usage(), "", "  use repo|solution|run|session <value>     remember a value for the next commands",
          "  context                                   show what is remembered", "  exit"].join("\n"));
        return true;
      case "context":
        this.print(this.describeContext());
        return true;
      case "use":
        this.use(rest);
        return true;
    }
    try {
      const { command: name, args } = parse(words);
      this.fill(name!, args.positionals, args.options);
      const result = await dispatch(this.app, name!, args, (question) => this.read(question).then((a) => a ?? ""),
        this.options.cwd);
      this.print(result.text);
      this.remember(name!, args.positionals, args.options, result.remember);
    } catch (error) {
      this.print((error as Error).message);
    }
    return true;
  }

  /** Completes command names, subcommands, options and the remembered values. */
  complete(line: string): [string[], string] {
    const words = line.split(/\s+/);
    const word = words.at(-1) ?? "";
    let candidates: string[];
    if (words.length <= 1) candidates = [...COMMANDS.map((c) => c.name), ...BUILT_INS];
    else if (words.length === 2 && SUBCOMMANDS[words[0]!]) candidates = SUBCOMMANDS[words[0]!]!;
    else if (word.startsWith("-")) candidates = OPTION_NAMES;
    else candidates = Object.values(this.context).filter((v): v is string => Boolean(v));
    return [candidates.filter((c) => c.startsWith(word)), word];
  }

  /** Fills in what the user left out from the context: the solution, the run, the repo, or the one open approval. */
  private fill(command: string, positionals: string[], options: Record<string, string | undefined>): void {
    if (SOLUTION_COMMANDS.has(command) && positionals.length === 0 && this.context.solution) {
      positionals.push(this.context.solution);
    }
    if (REPO_OPTION_COMMANDS.has(command) && !options.repo && this.context.repo) options.repo = this.context.repo;
    if (!options.session && this.context.session) options.session = this.context.session;
    if (command === "cleanup") {
      if (positionals[0] === "analyze" && positionals.length === 1 && this.context.repo) positionals.push(this.context.repo);
      if (RUN_ACTIONS.has(positionals[0] ?? "") && positionals.length === 1 && this.context.run) positionals.push(this.context.run);
    }
    if ((command === "approve" || command === "deny") && positionals.length === 0) {
      const open = this.app.approvals.open();
      if (open.length !== 1) {
        throw new Error(open.length ? `Several approvals are open; name one:\n${open.map((a) => `  ${a.id} ${a.kind} ${a.target}`).join("\n")}`
          : "Nothing waits for approval.");
      }
      positionals.push(open[0]!.id);
    }
  }

  private remember(command: string, positionals: string[], options: Record<string, string | undefined>, extra?: ShellContext): void {
    if (SOLUTION_COMMANDS.has(command) && positionals[0]) this.context.solution = positionals[0];
    if (REPO_OPTION_COMMANDS.has(command) && options.repo) this.context.repo = options.repo;
    if (command === "cleanup" && positionals[0] === "analyze" && positionals[1]) this.context.repo = positionals[1];
    if (command === "cleanup" && RUN_ACTIONS.has(positionals[0] ?? "") && positionals[1]) this.context.run = positionals[1];
    Object.assign(this.context, extra ?? {});
  }

  private use(words: string[]): void {
    const [key, value] = words;
    if (key !== "repo" && key !== "solution" && key !== "run" && key !== "session") {
      this.print("Use: use repo|solution|run|session <value>");
      return;
    }
    if (value) this.context[key] = value;
    else delete this.context[key];
    this.print(this.describeContext());
  }

  private describeContext(): string {
    const entries = Object.entries(this.context).filter(([, v]) => v);
    return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join("\n") : "Nothing remembered yet.";
  }

  private promptText(): string {
    const focus = this.context.run ? ` run ${this.context.run}` : this.context.solution ? ` ${this.context.solution.slice(0, 8)}` : "";
    return `aisdlc${focus}> `;
  }

  /** The next line typed after `question`; undefined once the input ends (Ctrl+D). */
  private async read(question: string): Promise<string | undefined> {
    this.rl.setPrompt(question);
    this.rl.prompt();
    const next = await this.lines.next();
    return next.done ? undefined : next.value;
  }

  private print(text: string): void {
    this.output.write(`${text}\n`);
  }

  private loadHistory(): string[] {
    const file = this.options.historyFile;
    if (!file || !existsSync(file)) return [];
    try {
      // readline keeps the newest entry first.
      return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).reverse().slice(0, MAX_HISTORY);
    } catch {
      return [];
    }
  }

  private saveHistory(): void {
    const file = this.options.historyFile;
    // readline keeps history only for a real terminal; a piped session must not wipe the saved one.
    if (!file || !this.options.terminal) return;
    try {
      const history = (this.rl as unknown as { history?: string[] }).history ?? [];
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, [...history].reverse().join("\n"), "utf8");
    } catch {
      // History is a convenience; losing it never stops the session from closing.
    }
  }
}
