# ADR 0008: Gates run in throw-away containers against the existing SonarQube server

- **Status:** Accepted
- **Date:** 2026-11-03

## Context
The clean-up skill builds, tests and scans a repository over and over: once for the baseline, and again for every
batch. Running a repository's tests means running its code, and the repository is exactly the code we do not trust
yet. Engineers' machines also have different SDKs installed.

The question was whether to host SonarQube and the test suites in a temporary container for each clean-up.

| | Temporary SonarQube **server** | Temporary **scanner and test runners** |
|---|---|---|
| Start-up | 1–3 min. Elasticsearch needs `vm.max_map_count=262144`. | 1–2 s per container once the image is cached |
| Memory | 2–4 GB | what the build needs |
| Results | no history and no team quality profile, so they differ from the real server | the team's profiles and quality gate |
| Comparing with a baseline | none. Community Edition also has no branch or PR analysis. | yes, on the existing server |
| Security | — | the repository's code runs sandboxed, never on the host |

## Decision
- **SonarQube.** The existing server stays. Each clean-up run scans into its own project `aisdlc-cleanup-<runId>`,
  which works on every edition and never touches the team's project. The project is deleted at `cleanup finish`;
  when the token may not delete projects, the output says so.
- **Containers.** Builds, tests, formatters, gitleaks and the scanner run through `ContainerProcessRunner`.
  - It implements the existing `IProcessRunner`, so `XunitEvaluator` and `VitestEvaluator` run in a container
    unchanged.
  - The workspace is mounted at `/work`, and host paths in arguments are rewritten.
  - Every container gets `--rm`, `--read-only` with a fresh `/tmp`, `--cap-drop ALL` and `no-new-privileges`.
- **Network.**
  - Builds and tests run with `--network none`.
  - Restoring packages and the dependency audits get network access. They run with `npm ci --ignore-scripts`, so no
    install script runs.
  - The scanner gets network access too, with `SONAR_HOST_URL` and `SONAR_TOKEN` passed by name only. Docker reads
    the values from its own environment, so the token never appears in an argument or a process list.
- **Images.** The images are listed in `config/runners.yaml`. The .NET SDK image follows the repository's
  `TargetFramework`. npm, NuGet and the scanner's analyzers are cached in named volumes, because restoring is the main
  cost of each run.
- **No fallback.** Without Docker, the clean-up refuses to start. Running untrusted tests on the host is never the
  fallback.
- **Host only.** Git, the push and `gh` run on the host with the engineer's own credentials; containers never see
  them.

## Consequences
- **+** Batches are measured in seconds, not minutes, and compared with the team's real quality profile.
- **+** A repository's tests cannot reach the network, the host's files or the engineer's credentials.
- **−** Docker is required.
- **−** The Node, gitleaks and scanner images are pinned by digest. The .NET SDK images are pinned by tag until
  they are first pulled.

## Learned from the first real run (2026-11-03)
Fixture: a TypeScript repository, against a local SonarQube Community Build 26.10 with an analysis token (`sqa_`).
- **Timings.** The analysis took 26 s, and each batch check about 25 s: `npm ci`, Vitest, scan, gitleaks and the
  audit, all in containers.
- **A local server.** In a container, `localhost` is the container itself, so the scanner is pointed at
  `host.docker.internal`, and the container gets `--add-host host.docker.internal:host-gateway`.
- **What an analysis token may not do.** It may scan, and read issues, the quality gate and measures. It may not read
  security hotspots or delete projects:
  - hotspots are left out of every measurement alike, and the plan and report say so;
  - `cleanup finish` asks for the temporary project to be deleted by hand.

  A user token with Browse on the projects avoids both.
- **Long paths on Windows.** Deep work folders can go past Windows' 260-character path limit. Keep `AISDLC_HOME`
  short, or enable git's `core.longpaths`.
- **−** C# analysis needs the SonarScanner for .NET (begin, build, end), which has no runner image yet. For
  .NET-only repositories the Sonar gate reports `skipped`; their tests, formatter, gitleaks and dependency audit run.
- **−** The containers still run as root inside the container, without capabilities. On Linux hosts, files written
  to the workspace belong to root.
