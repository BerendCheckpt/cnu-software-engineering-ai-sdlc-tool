# cnu-software-engineering-ai-sdlc-tool (`aisdlc`)

Deterministic-first knowledge, migration planning and evaluation for coding tasks, built so that **small local models**
(through cnu-claude-agent and Ollama) choose and fill in instead of exploring and writing freely.

- **Reuse first.** A prompt is matched against solutions that engineers already evaluated and accepted. A confident
  match is suggested with its test results and where it was applied, with no model involved.
- **Human in the loop.** Engineers accept or reject suggestions; a rejection starts a short model session from their
  reason. Downloads, clones and accepting solutions are human decisions, made only through the CLI.
- **Bounded context.** The model gets 8 MCP tools whose results are capped (5 hits, 40 to 60 lines), local read-only
  official docs, and read-only repository mirrors.
- **Evaluation.** xUnit, Vitest, Angular tests and SonarQube run in containers; the result is a short digest and a
  PR report.
- **Fixed until clean.** A task is not done while a BLOCKER or HIGH SonarQube issue is open. The model gets up to
  three fix attempts after the first check; then a GitHub issue hands it to a human (ADR 0010).
- **Clean-up.** A repository is cleaned up into a PR in small batches. Each batch is measured in throw-away containers,
  It runs in automode on one branch, `cleanup/DD-MM-YYYY`, and ends in a PR whose body ranks the fixed findings by
  severity and lists every security concern. The PR is the review; no approval is asked on the way. Follow the steps
  live with `aisdlc watch [<session>]`.

Read [docs/architecture.md](docs/architecture.md) first, then the [ADRs](docs/adr) and the
[entity model](docs/entities.md).

## Quick start

Needs Node 22.13 or later, and git. `dotnet` is needed for the xUnit gate.

```bash
npm ci
```
```bash
npm run build
```
```bash
npm test
```

Install the `aisdlc` command, so it works from any folder (on Windows this adds `aisdlc.cmd` to npm's global folder):

```bash
npm link
```

Run `aisdlc` on its own for an interactive session:

```bash
aisdlc
```

In the session, type the commands without `aisdlc` in front. It has history and tab completion, and it remembers the
repo, solution and clean-up run you used, so you do not type ids twice:
- `use repo|solution|run <value>` sets one; `context` shows them.
- `approve` without an id takes the only open approval.
- `help` lists every command, and `exit` (or Ctrl+D) leaves.

Every command also runs on its own, which is how models and skills call it:

```bash
aisdlc docs request dotnet-10-compat
```
```bash
aisdlc lookup "Add a minimal API endpoint for orders"
```

`approve`, `deny` and `reopen` ask for confirmation, and only run when a person is at an interactive terminal.

### A repository you already pulled

There is no need to clone it again. Run aisdlc from inside the folder, and `eval`, `migrate` and `cleanup analyze` use it
when no `--repo` is given:

```bash
cd "$env:USERPROFILE\Documents\Repositories\shop"; aisdlc cleanup analyze
```

The first time, the folder is linked under its own name; `aisdlc repo link <folder> --name <n>` picks another name.
`aisdlc repo list` shows mirrors and linked folders, and `aisdlc repo unlink <name>` forgets one.

aisdlc only reads a linked folder. Builds, tests, migrations and clean-ups run on a copy of the last commit of the
branch you have checked out, under `work/`. Your branch and uncommitted files stay as they are, and the CLI says when
there are uncommitted changes that the copy does not contain. A clean-up's push goes to the folder's own
`origin`.

## Configuration

| Setting | Where | Notes |
|---|---|---|
| Documentation sources and allowed hosts | `config/sources.yaml` | entries marked `added:` were not in the original list; review them |
| Migration paths | `config/migrations.yaml` | a pair not listed here is escalated to a human |
| Data root | `AISDLC_HOME` (environment only) | defaults to this repository; holds `.env`, `knowledge/`, `mirrors/`, `work/` |
| Tokens, URLs and ports | `.env` in the data root | copy `.env.example`; ignored by git; a value in `.env` wins over the environment |
| SonarQube | `SONAR_HOST_URL`, `SONAR_TOKEN` in `.env` | never logged, passed to the scanner container by name |
| Chat gateway | `AISDLC_UPSTREAM_URL`, `AISDLC_GATEWAY_HOST`, `AISDLC_GATEWAY_PORT` in `.env` | listens on `127.0.0.1:8091` unless set |
| Clean-up batches and human gates | `config/cleanup.yaml` | limits, category order, `maxTries` (5) per batch before the engineer decides, test, dependency and security patterns. Which SonarQube severities a run must fix is `cleanup analyze --severity verbose\|medium\|high` (default `verbose`) |
| SonarQube fix loop | `config/quality.yaml` | blocking and reported severities, `maxFixAttempts` (3); escalation needs `gh` logged in |
| Container images for the gates | `config/runners.yaml` | needs Docker; pin each image by digest after its first pull |

## Using it from other places

| From | How |
|---|---|
| A Claude Code session | the [`aisdlc-knowledge` skill](skills/aisdlc-knowledge/SKILL.md), or the MCP server through `.mcp.json` |
| A Claude Code session, to clean up a repository | the [`aisdlc-cleanup` skill](skills/aisdlc-cleanup/SKILL.md), with its batch loop in the [`aisdlc-cleanup-batches` subagent](agents/aisdlc-cleanup-batches.md) (link it into `~/.claude/agents/`) |
| cnu-claude-agent (benchmarks, local models) | `npm run gateway` in front of it, unchanged; see the [integration notes](docs/integration-cnu-claude-agent.md) |

## Layout

| Path | What |
|---|---|
| `src/domain` | entities and rules, no I/O |
| `src/ports` | interfaces the use cases depend on |
| `src/application` | one class per use case |
| `src/infrastructure` | SQLite (FTS5), docs fetcher, git mirror, evaluators, report writer |
| `src/adapters` | composition root, CLI, MCP server, front door |
| `test` | Vitest unit and adapter tests; coverage as lcov for SonarQube |
