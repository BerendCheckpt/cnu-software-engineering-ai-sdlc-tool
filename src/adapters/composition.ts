import path from "node:path";
import { fileURLToPath } from "node:url";
import { DecideApproval } from "../application/classes/approval/DecideApproval.js";
import { RequestApproval } from "../application/classes/approval/RequestApproval.js";
import { AnalyzeRepository } from "../application/classes/cleanup/AnalyzeRepository.js";
import { CheckBatch } from "../application/classes/cleanup/CheckBatch.js";
import { CheckCi } from "../application/classes/cleanup/CheckCi.js";
import { CleanupFolders } from "../application/classes/cleanup/CleanupFolders.js";
import { CleanupStatus } from "../application/classes/cleanup/CleanupStatus.js";
import { EscalateBatch } from "../application/classes/cleanup/EscalateBatch.js";
import { FinishCleanup } from "../application/classes/cleanup/FinishCleanup.js";
import { MeasureWorkspace } from "../application/classes/cleanup/MeasureWorkspace.js";
import { NextBatch } from "../application/classes/cleanup/NextBatch.js";
import { RetryBatch } from "../application/classes/cleanup/RetryBatch.js";
import { SkipBatch } from "../application/classes/cleanup/SkipBatch.js";
import { PullDocs } from "../application/classes/docs/PullDocs.js";
import { ReindexDocs } from "../application/classes/docs/ReindexDocs.js";
import { RequestDocs } from "../application/classes/docs/RequestDocs.js";
import { SearchDocs } from "../application/classes/docs/SearchDocs.js";
import { EvaluateSolution } from "../application/classes/evaluation/EvaluateSolution.js";
import { PrepareWorkspace } from "../application/classes/evaluation/PrepareWorkspace.js";
import { ReopenSolution } from "../application/classes/evaluation/ReopenSolution.js";
import { ReviseSolution } from "../application/classes/evaluation/ReviseSolution.js";
import { RunEvaluations } from "../application/classes/evaluation/RunEvaluations.js";
import { WriteReport } from "../application/classes/evaluation/WriteReport.js";
import { CrystallizeFolders } from "../application/classes/migration/CrystallizeFolders.js";
import { CrystallizeMigration } from "../application/classes/migration/CrystallizeMigration.js";
import { PlanMigration } from "../application/classes/migration/PlanMigration.js";
import { RequestCrystallization } from "../application/classes/migration/RequestCrystallization.js";
import { SonarFixLoop } from "../application/classes/quality/SonarFixLoop.js";
import { BrowseCode } from "../application/classes/repository/BrowseCode.js";
import { LinkRepository } from "../application/classes/repository/LinkRepository.js";
import { MirrorRepository } from "../application/classes/repository/MirrorRepository.js";
import { RequestClone } from "../application/classes/repository/RequestClone.js";
import { AcceptSolution } from "../application/classes/solution/AcceptSolution.js";
import { AcceptSuggestion } from "../application/classes/solution/AcceptSuggestion.js";
import { LookupSolutions } from "../application/classes/solution/LookupSolutions.js";
import { ProposeSolution } from "../application/classes/solution/ProposeSolution.js";
import { RecordApplication } from "../application/classes/solution/RecordApplication.js";
import { RejectSuggestion } from "../application/classes/solution/RejectSuggestion.js";
import { CleanupPlanner } from "../domain/classes/cleanup/CleanupPlanner.js";
import { DiffClassifier } from "../domain/classes/cleanup/DiffClassifier.js";
import { MarkdownChunker } from "../domain/classes/docs/MarkdownChunker.js";
import { UrlPolicy } from "../domain/classes/security/UrlPolicy.js";
import { ContainerGateFactory } from "../infrastructure/classes/cleanup/ContainerGateFactory.js";
import { DependencyRestorer } from "../infrastructure/classes/cleanup/DependencyRestorer.js";
import { FileDocArchive } from "../infrastructure/classes/docs/FileDocArchive.js";
import { HttpDocFetcher } from "../infrastructure/classes/docs/HttpDocFetcher.js";
import { YamlSourceCatalog } from "../infrastructure/classes/docs/YamlSourceCatalog.js";
import { SonarClient } from "../infrastructure/classes/evaluation/SonarClient.js";
import { DotnetFormatter } from "../infrastructure/classes/formatters/DotnetFormatter.js";
import { EslintFormatter } from "../infrastructure/classes/formatters/EslintFormatter.js";
import { GhCiChecks } from "../infrastructure/classes/git/GhCiChecks.js";
import { GhIssueTracker } from "../infrastructure/classes/git/GhIssueTracker.js";
import { GhPullRequestPublisher } from "../infrastructure/classes/git/GhPullRequestPublisher.js";
import { GitRepoMirror } from "../infrastructure/classes/git/GitRepoMirror.js";
import { GitWorkspace } from "../infrastructure/classes/git/GitWorkspace.js";
import { YamlMigrationCatalog } from "../infrastructure/classes/migration/YamlMigrationCatalog.js";
import { ContainerProcessRunner } from "../infrastructure/classes/process/ContainerProcessRunner.js";
import { ExecFileRunner } from "../infrastructure/classes/process/ExecFileRunner.js";
import { RunnerCatalog } from "../infrastructure/classes/process/RunnerCatalog.js";
import { ProgressHub } from "../infrastructure/classes/progress/ProgressHub.js";
import { SessionLog } from "../infrastructure/classes/progress/SessionLog.js";
import { CleanupReportWriter } from "../infrastructure/classes/reporting/CleanupReportWriter.js";
import { EscalationReportWriter } from "../infrastructure/classes/reporting/EscalationReportWriter.js";
import { MarkdownReportWriter } from "../infrastructure/classes/reporting/MarkdownReportWriter.js";
import { MarkdownSkillWriter } from "../infrastructure/classes/reporting/MarkdownSkillWriter.js";
import { SqliteApprovalStore } from "../infrastructure/classes/sqlite/SqliteApprovalStore.js";
import { SqliteCleanupStore } from "../infrastructure/classes/sqlite/SqliteCleanupStore.js";
import { SqliteDocStore } from "../infrastructure/classes/sqlite/SqliteDocStore.js";
import { SqliteFixLoopStore } from "../infrastructure/classes/sqlite/SqliteFixLoopStore.js";
import { SqliteLinkedRepositoryStore } from "../infrastructure/classes/sqlite/SqliteLinkedRepositoryStore.js";
import { SqliteSolutionStore } from "../infrastructure/classes/sqlite/SqliteSolutionStore.js";
import { loadCleanupPolicy } from "../infrastructure/helpers/cleanup/loadCleanupPolicy.js";
import { loadEnvFile } from "../infrastructure/helpers/config/loadEnvFile.js";
import { loadNoiseRules } from "../infrastructure/helpers/migration/loadNoiseRules.js";
import { loadQualityPolicy } from "../infrastructure/helpers/quality/loadQualityPolicy.js";
import { openDatabase } from "../infrastructure/helpers/sqlite/openDatabase.js";
import type { AppOptions } from "./interfaces/composition/AppOptions.js";
import type { AppPaths } from "./interfaces/composition/AppPaths.js";
import type { CleanupParts } from "./interfaces/composition/CleanupParts.js";

/** The repository root: `dist/adapters/composition.js` → `../..`. Override with `AISDLC_HOME`. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  const classifier = new DiffClassifier(policy.patterns);
  return {
    analyze: new AnalyzeRepository(folders, store, mirror, git, parts.sandbox, measure,
      new CleanupPlanner(policy.limits, policy.order), writer, progress),
    next: new NextBatch(store, git, parts.formatters, progress),
    check: new CheckBatch(store, git, parts.sandbox, measure, classifier, fixLoop, policy.maxTries, progress),
    retry: new RetryBatch(store, fixLoop, progress),
    escalate: new EscalateBatch(store, git, parts.sandbox, measure, classifier, fixLoop, mirror, parts.gates, progress),
    skip: new SkipBatch(store, git, progress),
    finish: new FinishCleanup(folders, store, parts.gates, writer, fixLoop, git,
      parts.publisher ?? new GhPullRequestPublisher(host), searchDocs, progress),
    ci: new CheckCi(store, git, parts.ci ?? new GhCiChecks(host), fixLoop, policy.maxTries, progress),
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
