import path from "node:path";
import { DomainError } from "../../domain/errors.js";
import type { IProcessRunner, ISandbox, ProcessResult } from "../../ports/services.js";
import type { RunnerCatalog } from "./runnerCatalog.js";

const MOUNT = "/work";

export interface ContainerOptions {
  /** `none` for builds, tests and local scans; `bridge` only for restoring packages and reaching SonarQube. */
  network: "none" | "bridge";
  /**
   * Names of host environment variables handed to the container, for example `SONAR_TOKEN`. Only the name goes on
   * the command line; Docker reads the value from its own environment, so a secret never shows up in `ps`.
   */
  passEnvironment?: string[];
  /** Lets the container reach a server on this machine as `host.docker.internal`, also on Linux. */
  reachHost?: boolean;
}

/**
 * Runs a program in a throw-away container instead of on the host. Every evaluator that takes an `IProcessRunner`
 * works unchanged: the working directory is mounted at `/work`, and host paths inside it are rewritten.
 *
 * The container gets no capabilities, a read-only root file system, a fresh `/tmp`, and is removed afterwards.
 */
export class ContainerProcessRunner implements IProcessRunner, ISandbox {
  constructor(
    private readonly host: IProcessRunner,
    private readonly runners: RunnerCatalog,
    private readonly options: ContainerOptions,
  ) {}

  async ensureAvailable(): Promise<void> {
    const info = await this.host.run("docker", ["info", "--format", "{{.ServerVersion}}"], process.cwd(), 30_000);
    if (info.exitCode !== 0) {
      throw new DomainError("Docker is not available. The clean-up builds, tests and scans repositories only in " +
        "containers, never on this machine. Start Docker and try again.");
    }
  }

  run(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<ProcessResult> {
    return this.host.run("docker", this.dockerArgs(command, args, cwd), cwd, timeoutMs);
  }

  dockerArgs(command: string, args: string[], cwd: string): string[] {
    const runner = this.runners.runnerFor(command, cwd);
    return [
      "run", "--rm",
      "--network", this.options.network,
      ...(this.options.reachHost ? ["--add-host", "host.docker.internal:host-gateway"] : []),
      "--read-only", "--tmpfs", "/tmp",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--volume", `${path.resolve(cwd)}:${MOUNT}`, "--workdir", MOUNT,
      ...Object.entries(runner.caches).flatMap(([volume, target]) => ["--volume", `${volume}:${target}`]),
      ...Object.entries(runner.environment).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
      ...(this.options.passEnvironment ?? []).flatMap((name) => ["--env", name]),
      "--entrypoint", this.program(command),
      runner.image,
      ...args.map((a) => toContainerPath(a, cwd)),
    ];
  }

  /** `process.execPath` is the host's node; in the container it is just `node`. */
  private program(command: string): string {
    if (command === process.execPath) return "node";
    return path.basename(command).replace(/\.(exe|cmd)$/i, "");
  }
}

/** Inside a container `localhost` is the container itself; this machine is `host.docker.internal`. */
export function reachableFromContainer(url: string): string {
  const parsed = new URL(url);
  if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) parsed.hostname = "host.docker.internal";
  return parsed.href.replace(/\/$/, "");
}

/** Rewrites a host path inside the mounted folder, also inside `--option=<path>`, to its path under `/work`. */
export function toContainerPath(arg: string, cwd: string): string {
  const root = path.resolve(cwd);
  const at = process.platform === "win32" ? arg.toLowerCase().indexOf(root.toLowerCase()) : arg.indexOf(root);
  if (at < 0) return arg;
  const rest = arg.slice(at + root.length);
  if (rest && !/^[\\/]/.test(rest)) return arg;
  return `${arg.slice(0, at)}${MOUNT}${rest.replaceAll("\\", "/")}`;
}
