import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { DomainError } from "../../domain/errors.js";

const NAME = /^[a-z0-9][a-z0-9_.-]*$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const Runner = z.object({
  image: z.string().regex(/^[a-z0-9][a-z0-9./:@_-]*$/),
  caches: z.record(z.string().regex(NAME), z.string().startsWith("/")).default({}),
  environment: z.record(z.string().regex(ENV_NAME), z.string()).default({}),
});

const Catalog = z.object({
  runners: z.record(z.string().regex(NAME), Runner),
  commands: z.record(z.string().regex(NAME), z.string().regex(NAME)),
});

export type RunnerSpec = z.infer<typeof Runner>;

const SKIPPED_FOLDERS = new Set(["node_modules", "bin", "obj", ".git", ".aisdlc"]);

/** The runners in `config/runners.yaml`, and which one a program runs in. */
export class RunnerCatalog {
  private readonly catalog: z.infer<typeof Catalog>;

  constructor(file: string) {
    this.catalog = Catalog.parse(parse(readFileSync(file, "utf8")));
  }

  /** The runner for `command` (a program name or path) in this workspace. */
  runnerFor(command: string, workspace: string): RunnerSpec {
    const program = path.basename(command).replace(/\.(exe|cmd)$/i, "").toLowerCase();
    const name = program === "dotnet" ? `dotnet${this.dotnetMajor(workspace)}` : this.catalog.commands[program];
    const runner = name ? this.catalog.runners[name] : undefined;
    if (!runner) throw new DomainError(`No container runner for ${program}${name ? ` (${name})` : ""} in runners.yaml.`);
    return runner;
  }

  /** The .NET major version of the first project found, from `<TargetFramework>net10.0</TargetFramework>`. */
  private dotnetMajor(workspace: string): number {
    for (const project of findProjects(workspace, 3)) {
      const framework = /<TargetFrameworks?>\s*net(\d+)\.\d/.exec(readFileSync(project, "utf8"));
      if (framework) return Number(framework[1]);
    }
    throw new DomainError("No <TargetFramework> found, so the .NET SDK version is unknown.");
  }
}

function findProjects(folder: string, depth: number): string[] {
  const entries = readdirSync(folder, { withFileTypes: true });
  const here = entries.filter((e) => e.isFile() && e.name.endsWith(".csproj")).map((e) => path.join(folder, e.name));
  if (depth === 0) return here;
  const below = entries
    .filter((e) => e.isDirectory() && !SKIPPED_FOLDERS.has(e.name))
    .flatMap((e) => findProjects(path.join(folder, e.name), depth - 1));
  return [...here, ...below];
}
