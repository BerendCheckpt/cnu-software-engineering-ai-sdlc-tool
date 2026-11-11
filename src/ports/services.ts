import type { CleanupBatch, CleanupRun, Finding } from "../domain/cleanup.js";
import type { DocSource } from "../domain/docs.js";
import type { EvaluationKind, EvaluationResult } from "../domain/evaluation.js";
import type { CodeLocation, MigrationPath, MigrationSkill } from "../domain/migration.js";
import type { StepEvent, StepStatus } from "../domain/progress.js";
import type { FixLoop } from "../domain/quality.js";
import type { RepositoryEntry } from "../domain/repository.js";
import type { Solution } from "../domain/solution.js";

/** Downloads one page and returns it as markdown. */
export interface IDocFetcher {
  fetchMarkdown(url: URL): Promise<string>;
}

/** The source manifest: which pages exist, and which hosts docs and repositories may come from. */
export interface ISourceCatalog {
  docHosts(): string[];
  repositoryHosts(): string[];
  find(sourceId: string): DocSource | undefined;
  all(): DocSource[];
}

/** Keeps downloaded pages as read-only files, for humans to open and for audit. */
export interface IDocArchive {
  write(source: DocSource, markdown: string): string;
  /** The page as it was downloaded, or undefined when it is not archived. */
  read(source: DocSource): ArchivedPage | undefined;
}

export interface ArchivedPage {
  markdown: string;
  /** ISO time of the download. */
  fetchedAt: string;
}

/** Read-only local copies of repositories. */
export interface IRepoMirror {
  exists(name: string): boolean;
  clone(name: string, url: URL): Promise<void>;
  /** With `minTermsPerFile`, only files that contain that many different terms count. */
  search(name: string, terms: string[], limit: number, minTermsPerFile?: number): Promise<CodeLocation[]>;
  /** Whether the repository shows any of the markers: a file glob such as `*.razor`, or a word in the code. */
  uses(name: string, markers: string[]): Promise<boolean>;
  read(name: string, relativePath: string, startLine: number, endLine: number): Promise<string>;
  /** A writable copy of a mirror for evaluation, inside the work folder. */
  checkout(name: string, destination: string): Promise<void>;
  /** Applies a unified diff to a checked-out copy. */
  applyPatch(destination: string, diff: string): Promise<void>;
  /** The repository the mirror was cloned from (its `origin`), or undefined when it has none. */
  remoteUrl(name: string): Promise<string | undefined>;
  /** The root of the git repository a folder is in, or undefined when it is not in one. */
  topLevel(folder: string): Promise<string | undefined>;
  /** The mirror or linked folder at this path, if there is one. */
  nameAt(folder: string): RepositoryEntry | undefined;
  /** Every mirror and linked folder. */
  list(): RepositoryEntry[];
  /** For a linked folder: its checked-out branch and how many files are not committed. */
  workingState(name: string): Promise<{ branch: string; uncommitted: number }>;
}

export interface IEvaluator {
  readonly kind: EvaluationKind;
  evaluate(workspace: string): Promise<EvaluationResult>;
}

/** Renders the combined evaluation report for a pull request. */
export interface IReportWriter {
  /** `openIssues` are the SonarQube issues still open at the last check, blocking or only reported. */
  render(solution: Solution, evaluations: EvaluationResult[], summary?: string, openIssues?: Finding[]): string;
}

/** Opens an issue for a human in the working repository; returns its URL, or what the engineer has to do by hand. */
export interface IIssueTracker {
  open(remoteUrl: string | undefined, title: string, bodyFile: string): Promise<string>;
}

/** What a human needs to pick up a task the model could not finish. Never holds a token or a secret's value. */
export interface EscalationContext {
  /** One line: what the task was. */
  task: string;
  /** More about the task: the request and summary, or the clean-up batch. */
  details: string[];
  repository: string;
  remoteUrl?: string;
  /** Branch, commit and workspace, as far as they are known. */
  location: string[];
  sonarProjectUrl?: string;
  /** The change of the last attempt. */
  diff: string;
  /** The exact command that repeats the failing check. */
  reproduce: string;
  limitations: string[];
}

/** Fixed template for an escalation issue. */
export interface IEscalationWriter {
  render(context: EscalationContext, loop: FixLoop, maxFixAttempts: number): { title: string; body: string };
  /** One finding the engineer chose to leave open after the batch's tries, as its own issue. */
  renderFinding(context: EscalationContext, finding: Finding, loop: FixLoop): { title: string; body: string };
}

export interface IMigrationCatalog {
  findSkill(from: string, to: string): MigrationSkill | undefined;
  findPath(from: string, to: string): MigrationPath | undefined;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs a program without a shell, so arguments are never interpreted. */
export interface IProcessRunner {
  run(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<ProcessResult>;
}

/** Where builds, tests and scanners of a repository run. The clean-up refuses to run without it. */
export interface ISandbox {
  ensureAvailable(): Promise<void>;
}

/** Restores packages, the one step that needs the network, so the gates after it can run without. */
export interface IDependencyRestorer {
  restore(workspace: string): Promise<void>;
}

/** Reports open problems in a workspace: one class per tool. */
export interface IFindingSource {
  readonly name: string;
  /** Throws when it cannot report; returning fewer findings than exist would make them look fixed. */
  collect(workspace: string): Promise<Finding[]>;
  /** What the last `collect` could not look at, the same way every time, for example for lack of permission. */
  limitations?(): string[];
}

/** A tool that fixes formatting by itself, without a model. */
export interface IFormatter {
  readonly name: string;
  /** False when the tool does not apply to this workspace. */
  apply(workspace: string): Promise<boolean>;
}

/** The gates and finding sources for one clean-up run, which has its own SonarQube project. */
export interface CleanupGates {
  evaluators: IEvaluator[];
  findingSources: IFindingSource[];
  /** Where a human sees the open issues of this run's SonarQube project, when SonarQube is configured. */
  sonarProjectUrl?: string;
  /** The SonarQube project's key, when SonarQube is configured. */
  sonarProject?: string;
  /** Removes what the run created on outside servers; returns a note when a human has to finish that. */
  release(): Promise<string | undefined>;
}

export interface ICleanupGateFactory {
  /** `purpose` names the SonarQube project, `aisdlc-<purpose>-<id>`: a clean-up run or a solution. */
  forRun(id: string, purpose?: "cleanup" | "solution"): CleanupGates;
}

/** Where a command reports its steps, so a terminal or a listener can follow them live. */
export interface IProgress {
  emit(step: string, status: StepStatus, detail?: string): void;
}

/** One listener of step events: the terminal, a session log file. */
export interface IProgressSink {
  write(event: StepEvent): void;
}

/** The clean-up's writable git checkout. Pushing is the only call that reaches outside the machine. */
export interface IGitWorkspace {
  /**
   * Creates the branch and points `origin` at the mirror's own remote. Refuses when the branch already exists in the
   * mirror or on the remote: a branch there means a clean-up or migration already ran on this data. `note` says what
   * could not be checked.
   */
  prepare(workspace: string, branch: string): Promise<{ baseBranch: string; baseSha: string; note?: string }>;
  head(workspace: string): Promise<string>;
  /** Every change since `since`, committed or not, including new files. */
  diffSince(workspace: string, since: string): Promise<string>;
  commit(workspace: string, message: string): Promise<string>;
  resetTo(workspace: string, sha: string): Promise<void>;
  push(workspace: string, branch: string): Promise<void>;
}

/** Opens the pull request for a pushed branch; returns its URL, or what the engineer has to do by hand. */
export interface IPullRequestPublisher {
  open(workspace: string, branch: string, baseBranch: string, title: string, bodyFile: string): Promise<string>;
}

/** A section of the pulled official docs about a security rule. */
export interface DocReference {
  heading: string;
  url: string;
}

/** Fixed templates for the clean-up plan and the PR body. */
export interface ICleanupReportWriter {
  plan(run: CleanupRun, batches: CleanupBatch[]): string;
  /** `docs` maps a security finding's rule to what the pulled docs say about it; undefined when no docs are pulled. */
  report(run: CleanupRun, batches: CleanupBatch[], docs?: Map<string, DocReference>, sonarProject?: string): string;
}
