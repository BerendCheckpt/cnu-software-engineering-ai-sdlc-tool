import path from "node:path";
import { fileURLToPath } from "node:url";
import { DecideApproval, RequestApproval } from "../application/approvals.js";
import {
  AnalyzeRepository, CheckBatch, CleanupFolders, CleanupStatus, FinishCleanup, MeasureWorkspace, NextBatch, SkipBatch,
} from "../application/cleanup.js";
import { CrystallizeFolders, CrystallizeMigration, RequestCrystallization } from "../application/crystallize.js";
import { PullDocs, ReindexDocs, RequestDocs, SearchDocs } from "../application/docs.js";
import {
  EvaluateSolution, PrepareWorkspace, ReopenSolution, ReviseSolution, RunEvaluations, WriteReport,
} from "../application/evaluation.js";
import { LookupSolutions } from "../application/lookupSolutions.js";
import { PlanMigration } from "../application/planMigration.js";
import { BrowseCode, LinkRepository, MirrorRepository, RequestClone } from "../application/repositories.js";
import { AcceptSuggestion, RejectSuggestion } from "../application/reviewSuggestion.js";
import { AcceptSolution, ProposeSolution, RecordApplication } from "../application/solutionLifecycle.js";
import { SonarFixLoop } from "../application/sonarFixLoop.js";
import { CleanupPlanner } from "../domain/cleanupPlanner.js";
import { DiffClassifier } from "../domain/diffClassifier.js";
import { MarkdownChunker } from "../domain/markdownChunker.js";
import { UrlPolicy } from "../domain/urlPolicy.js";
import { ContainerGateFactory } from "../infrastructure/cleanup/containerGateFactory.js";
import { DependencyRestorer } from "../infrastructure/cleanup/dependencyRestorer.js";
import { loadCleanupPolicy } from "../infrastructure/cleanup/yamlCleanupPolicy.js";
import { FileDocArchive } from "../infrastructure/docs/fileDocArchive.js";
import { HttpDocFetcher } from "../infrastructure/docs/httpDocFetcher.js";
import { loadEnvFile } from "../infrastructure/config/envFile.js";
import { YamlSourceCatalog } from "../infrastructure/docs/yamlSourceCatalog.js";
import { SonarClient } from "../infrastructure/evaluation/sonarClient.js";
import { DotnetFormatter, EslintFormatter } from "../infrastructure/formatters/formatters.js";
import { GhIssueTracker } from "../infrastructure/git/ghIssueTracker.js";
import { GhPullRequestPublisher } from "../infrastructure/git/ghPullRequestPublisher.js";
import { GitRepoMirror } from "../infrastructure/git/gitRepoMirror.js";
import { GitWorkspace } from "../infrastructure/git/gitWorkspace.js";
import { YamlMigrationCatalog } from "../infrastructure/migration/yamlMigrationCatalog.js";
import { loadNoiseRules } from "../infrastructure/migration/yamlNoiseRules.js";
import { ContainerProcessRunner } from "../infrastructure/process/containerProcessRunner.js";
import { ExecFileRunner } from "../infrastructure/process/execFileRunner.js";
import { ProgressHub, SessionLog } from "../infrastructure/progress/progress.js";
import { RunnerCatalog } from "../infrastructure/process/runnerCatalog.js";
import { loadQualityPolicy } from "../infrastructure/quality/yamlQualityPolicy.js";
import { CleanupReportWriter } from "../infrastructure/reporting/cleanupReportWriter.js";
import { EscalationReportWriter } from "../infrastructure/reporting/escalationReportWriter.js";
import { MarkdownReportWriter } from "../infrastructure/reporting/markdownReportWriter.js";
import { MarkdownSkillWriter } from "../infrastructure/reporting/skillWriter.js";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { SqliteApprovalStore } from "../infrastructure/sqlite/sqliteApprovalStore.js";
import { SqliteCleanupStore } from "../infrastructure/sqlite/sqliteCleanupStore.js";
import { SqliteDocStore } from "../infrastructure/sqlite/sqliteDocStore.js";
import { SqliteFixLoopStore } from "../infrastructure/sqlite/sqliteFixLoopStore.js";
import { SqliteLinkedRepositoryStore } from "../infrastructure/sqlite/sqliteLinkedRepositoryStore.js";
import { SqliteSolutionStore } from "../infrastructure/sqlite/sqliteSolutionStore.js";
import type {
  ICleanupGateFactory, IDependencyRestorer, IEvaluator, IFormatter, IIssueTracker, IPullRequestPublisher, ISandbox,
} from "../ports/services.js";

/** The repository root: `dist/adapters/composition.js` → `../..`. Override with `AISDLC_HOME`. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface AppPaths {
  home: string;
  database: string;
  docs: string;
  mirrors: string;
  work: string;
  sources: string;
  migrations: string;
  migrationSkills: string;
  cleanupPolicy: string;
  noise: string;
  quality: string;
  runners: string;
  /** The interactive session's command history. */
  history: string;
  /** One `<session>.jsonl` of step events per session, for listeners such as `aisdlc watch`. */
  sessions: string;
}

export function appPaths(home = process.env.AISDLC_HOME ?? PACKAGE_ROOT): AppPaths {
  return {
    home,
    database: path.join(home, "knowledge", "knowledge.db"),
    docs: path.join(home, "knowledge", "docs"),
    mirrors: path.join(home, "mirrors"),
    work: path.join(home, "work"),
    sources: path.join(home, "config", "sources.yaml"),
    migrations: path.join(home, "config", "migrations.yaml"),
    migrationSkills: path.join(home, "skills", "migrations"),
    cleanupPolicy: path.join(home, "config", "cleanup.yaml"),
    noise: path.join(home, "config", "noise.yaml"),
    quality: path.join(home, "config", "quality.yaml"),
    runners: path.join(home, "config", "runners.yaml"),
    history: path.join(home, "work", "shell-history.txt"),
    sessions: path.join(home, "work", "sessions"),
  };
}

export interface AppOptions {
  /** Replaces the containerized gates of `eval` and `run_evaluations`; tests use this to run without Docker. */
  evaluators?: IEvaluator[];
  /** Replaces the containers of the clean-up; tests use this to run without Docker. */
  cleanup?: CleanupParts;
  /** Replaces `gh issue create` for escalations; tests use this to stay off GitHub. */
  issueTracker?: IIssueTracker;
}

export interface CleanupParts {
  sandbox: ISandbox;
  restorer: IDependencyRestorer;
  gates: ICleanupGateFactory;
  formatters: IFormatter[];
  publisher?: IPullRequestPublisher;
}

/** The composition root: the only place that knows every concrete class. */
export function createApp(paths: AppPaths = appPaths(), options: AppOptions = {}) {
  // Tokens, URLs and ports come from `<home>/.env` (or the environment), before anything reads them.
  loadEnvFile(path.join(paths.home, ".env"));
  const db = openDatabase(paths.database);
  const solutions = new SqliteSolutionStore(db);
  const approvals = new SqliteApprovalStore(db);
  const docs = new SqliteDocStore(db);
  const sources = new YamlSourceCatalog(paths.sources);
  const runner = new ExecFileRunner();
  const linkedRepositories = new SqliteLinkedRepositoryStore(db);
  // Mirrors aisdlc cloned, and folders the engineer already pulled and linked; both are only read.
  const mirror = new GitRepoMirror(paths.mirrors, runner, linkedRepositories);

  const lookup = new LookupSolutions(solutions);
  const requestApproval = new RequestApproval(approvals);
  const requestDocs = new RequestDocs(sources, docs, requestApproval);
  const parts: CleanupParts = options.cleanup ?? containerParts(paths, runner);
  const fixLoops = new SqliteFixLoopStore(db);
  // One loop for every task that is scanned: a solution's eval and a clean-up batch's check (ADR 0010).
  const fixLoop = new SonarFixLoop(fixLoops, loadQualityPolicy(paths.quality), new EscalationReportWriter(),
    options.issueTracker ?? new GhIssueTracker(runner, paths.home), path.join(paths.work, "escalations"));
  const prepareWorkspace = new PrepareWorkspace(paths.work, solutions, mirror);
  // A solution is checked exactly like a clean-up batch: the same gates, in the same containers (ADR 0008).
  const runEvaluations = options.evaluators
    ? new RunEvaluations(paths.work, solutions, () => ({ evaluators: options.evaluators!, findingSources: [] }), ON_HOST,
      fixLoop, mirror)
    : new RunEvaluations(paths.work, solutions, (id) => parts.gates.forRun(id, "solution"), parts, fixLoop, mirror);
  const writeReport = new WriteReport(paths.work, solutions, new MarkdownReportWriter(), fixLoops);
  // Every step goes to the session's log; adapters attach the terminal as a second listener.
  const sessionLog = new SessionLog(paths.sessions);
  const progress = new ProgressHub();
  progress.attach(sessionLog);
  const searchDocs = new SearchDocs(docs);
  const cleanup = createCleanup(paths, db, mirror, runner, parts, fixLoop, progress, searchDocs);
  const migrations = new YamlMigrationCatalog(paths.migrations, paths.migrationSkills);
  const noise = loadNoiseRules(paths.noise);
  const archive = new FileDocArchive(paths.docs);
  const chunker = new MarkdownChunker(noise.boilerplateHeadings);
  const crystallizeFolders = new CrystallizeFolders(paths.work, paths.migrationSkills);

  return {
    paths,
    sources,
    approvals,
    lookup,
    acceptSuggestion: new AcceptSuggestion(solutions),
    rejectSuggestion: new RejectSuggestion(solutions, lookup),
    proposeSolution: new ProposeSolution(solutions),
    acceptSolution: new AcceptSolution(solutions),
    recordApplication: new RecordApplication(solutions),
    reviseSolution: new ReviseSolution(paths.work, solutions),
    reopenSolution: new ReopenSolution(solutions, fixLoop),
    plan: (name: string) => solutions.plan(name),
    requestApproval,
    decideApproval: new DecideApproval(approvals),
    requestDocs,
    pullDocs: new PullDocs(sources, approvals, new HttpDocFetcher(new UrlPolicy(sources.docHosts())), archive, docs, chunker),
    reindexDocs: new ReindexDocs(sources, archive, docs, chunker),
    searchDocs,
    hasDocs: (id: string) => docs.hasSource(id),
    requestClone: new RequestClone(sources, requestApproval),
    mirrorRepository: new MirrorRepository(sources, approvals, mirror),
    linkRepository: new LinkRepository(linkedRepositories, mirror),
    browseCode: new BrowseCode(mirror),
    evaluateSolution: new EvaluateSolution(paths.work, prepareWorkspace, runEvaluations, writeReport),
    writeReport,
    planMigration: new PlanMigration(paths.work, migrations, docs, requestDocs, mirror, noise),
    requestCrystallization: new RequestCrystallization(crystallizeFolders, solutions, migrations, sources,
      new MarkdownSkillWriter(), requestApproval),
    crystallizeMigration: new CrystallizeMigration(crystallizeFolders, approvals, solutions),
    cleanup,
    progress,
    sessionLog,
    close: () => db.close(),
  };
}

/**
 * The clean-up's builds, tests and scans run in containers only (ADR 0008): one without network, one for the package
 * registries, one for SonarQube. Git, the push and `gh` run on the host with the engineer's own credentials.
 */
function createCleanup(
  paths: AppPaths, db: ReturnType<typeof openDatabase>, mirror: GitRepoMirror, host: ExecFileRunner,
  parts: CleanupParts, fixLoop: SonarFixLoop, progress: ProgressHub, searchDocs: SearchDocs,
) {
  const policy = loadCleanupPolicy(paths.cleanupPolicy);
  const store = new SqliteCleanupStore(db);
  const folders = new CleanupFolders(paths.work);
  const git = new GitWorkspace(host);
  const measure = new MeasureWorkspace(parts.restorer, parts.gates, progress);
  const writer = new CleanupReportWriter();
  return {
    analyze: new AnalyzeRepository(folders, store, mirror, git, parts.sandbox, measure,
      new CleanupPlanner(policy.limits, policy.order), writer, progress),
    next: new NextBatch(store, git, parts.formatters, progress),
    check: new CheckBatch(store, git, parts.sandbox, measure, new DiffClassifier(policy.patterns), fixLoop, mirror,
      parts.gates, progress),
    skip: new SkipBatch(store, git, fixLoop, progress),
    finish: new FinishCleanup(folders, store, parts.gates, writer, fixLoop, git,
      parts.publisher ?? new GhPullRequestPublisher(host), searchDocs, progress),
    status: new CleanupStatus(store),
  };
}

function containerParts(paths: AppPaths, host: ExecFileRunner): CleanupParts {
  const catalog = new RunnerCatalog(paths.runners);
  const offline = new ContainerProcessRunner(host, catalog, { network: "none" });
  const online = new ContainerProcessRunner(host, catalog, { network: "bridge" });
  // The token is passed by name only: Docker reads it from the environment, so it never appears in an argument.
  const scanner = new ContainerProcessRunner(host, catalog,
    { network: "bridge", passEnvironment: ["SONAR_TOKEN"], reachHost: true });
  const sonar = new SonarClient({ hostUrl: process.env.SONAR_HOST_URL, token: process.env.SONAR_TOKEN });
  return {
    sandbox: offline,
    restorer: new DependencyRestorer(online),
    gates: new ContainerGateFactory({ offline, online, scanner }, sonar),
    formatters: [new DotnetFormatter(offline), new EslintFormatter(offline)],
  };
}

/** For gates given in `AppOptions.evaluators`: fakes that need no container and no packages. */
const ON_HOST = { sandbox: { ensureAvailable: async () => {} }, restorer: { restore: async () => {} } };

export type App = ReturnType<typeof createApp>;
