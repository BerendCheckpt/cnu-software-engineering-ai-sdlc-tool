---
name: migrate-angular20-to-angular22
description: Migrate a repository from angular20 to angular22 with steps that were done, evaluated and accepted before. Use when an engineer asks to upgrade or migrate from angular20 to angular22.
---

# Migrate angular20 to angular22

Crystallized from solution `99559706-fc84-473a-a61d-2c6fcf84df33`: "Counter app on Angular 22: ng update 20 to 21 to 22, TypeScript 6.0, unit-test coverage option renamed, Node 24". A human accepted it after every gate below
passed. Follow the steps in order, and change only what a step names.

## Official tool

Run ng update @angular/core@21 @angular/cli@21, then @22: one major version at a time, as the Angular release policy says.

## Steps

1. **Measure first.** Run `aisdlc eval` on the unchanged repository and keep the result: the same tests must pass
   after the migration.
2. **Check Node and TypeScript before anything else** (`angular-versions`, "Actively supported versions"):
   - Angular 22 needs Node `^22.22.3`, `^24.15.0` or `^26.0.0`, and TypeScript `>=6.0.0 <6.1.0`.
   - Angular 21 runs on Node `^20.19.0`, `^22.12.0` or `^24.0.0`.

   Move local tooling, Dockerfiles and CI images to Node 24 LTS first; it runs 20, 21 and 22.
3. **One major version at a time** (`angular-releases`, `angular-cli-update`). Start from a clean git tree, and
   commit after each hop:
   1. `ng update @angular/core@21 @angular/cli@21`
   2. test and build, then commit;
   3. `ng update @angular/core@22 @angular/cli@22` (this also moves TypeScript to 6.0)
   4. test and build, then commit.
4. **Optional migrations only when they apply.** `ng update` lists them without running them:
   - `use-application-builder`: only if `angular.json` still uses the old browser builder.
   - `migrate-karma-to-vitest`: only if tests still run on Karma (`angular-migrating-to-vitest`).
   - `router-current-navigation`: only if the code calls `Router.getCurrentNavigation()`.
5. **Rename the unit-test coverage settings after the 21 update.** `ng test` fails schema validation otherwise:
   - In `angular.json`, the `@angular/build:unit-test` option `codeCoverageReporters` becomes `coverageReporters`.
   - On the command line, `--code-coverage` becomes `--coverage`.
6. **Review what the 22 migrations wrote:**
   - **Change detection.** Components without a strategy get `ChangeDetectionStrategy.Eager`, because OnPush is the
     default in 22. Keep `Eager` only where a component really needs it.
   - **Template diagnostics.** `tsconfig.app.json` and `tsconfig.spec.json` get `nullishCoalescingNotNullable` and
     `optionalChainNotNullable` set to `suppress`. Build without that suppression. If there are no NG8xxx warnings,
     leave it out; otherwise fix the templates the warnings name, then leave it out.
7. **Update build images and docs** that name a Node version, for example `node:22.13.x` images in READMEs, Dockerfiles
   and CI.
8. **Check.** `aisdlc eval` again: the same tests pass, and SonarQube reports no issue that was not there before.

## Official documentation

Read the part of these pages a step points to. If a page is not in the local docs, ask the engineer to approve
its download (`aisdlc docs request <id>`); never migrate without it.

- `angular-20-versions` (angular 20): https://v20.angular.dev/reference/versions
- `angular-20-releases` (angular 20): https://v20.angular.dev/reference/releases
- `angular-20-testing` (angular 20): https://v20.angular.dev/guide/testing
- `angular-versions` (angular latest): https://angular.dev/reference/versions
- `angular-releases` (angular latest): https://angular.dev/reference/releases
- `angular-cli-update` (angular latest): https://angular.dev/cli/update
- `angular-migrations` (angular latest): https://angular.dev/reference/migrations
- `angular-migrating-to-vitest` (angular latest): https://angular.dev/guide/testing/migrating-to-vitest
- `angular-21-releases` (angular 21): https://v21.angular.dev/reference/releases

## Done when

Every gate that passed before the migration passes after it, with the same tests: run `aisdlc eval` on the
migrated solution. These were the results when this skill was made:

| Gate | Result | Details |
|---|---|---|
| xunit | skipped | skipped: no .sln, .slnx or .csproj at the workspace root |
| vitest | skipped | skipped: Angular project: see the angular gate |
| angular | passed | 21/21 passed |
| sonar | passed | quality gate OK; coverage=0.0, bugs=0, code_smells=0, duplicated_lines_density=0.0, vulnerabilities=0, security_hotspots=0 |

## Rules

- A step that does not apply to this repository is skipped, and the summary says why.
- Anything this skill does not cover goes back to the engineer: run `aisdlc migrate` for a grounded plan instead.
