import path from "node:path";
import { DomainError } from "../../../domain/classes/errors/DomainError.js";
import type { IProcessRunner } from "../../../ports/interfaces/process/IProcessRunner.js";
import type { ISandbox } from "../../../ports/interfaces/process/ISandbox.js";
import type { ProcessResult } from "../../../ports/interfaces/process/ProcessResult.js";
import { programName } from "../../../shared/helpers/process/programName.js";
import { MOUNT } from "../../constants/process/MOUNT.js";
import { toContainerPath } from "../../helpers/process/toContainerPath.js";
import type { ContainerOptions } from "../../interfaces/process/ContainerOptions.js";
import type { RunnerCatalog } from "./RunnerCatalog.js";

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
    return programName(command);
  }
}
