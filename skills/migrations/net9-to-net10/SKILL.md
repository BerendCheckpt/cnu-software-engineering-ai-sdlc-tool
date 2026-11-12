---
name: migrate-net9-to-net10
description: Migrate a repository from net9 to net10 with steps that were done, evaluated and accepted before. Use when an engineer asks to upgrade or migrate from net9 to net10.
---

# Migrate net9 to net10

Crystallized from solution `cc01ba9f-1f42-45df-9799-0415846a0fc6`: "Counter app on .NET 10: net10.0, ASP.NET Core test package 10.0.14, public Program (ASP0027), README build image". A human accepted it after every gate below
passed. Follow the steps in order, and change only what a step names.

## Official tool

Set <TargetFramework> to net10.0 in each project file, then build and fix what the breaking-change guide lists.

## Steps

1. **Measure first.** Run `aisdlc eval` on the unchanged repository and keep the result: the same tests must pass
   after the migration.
2. **Retarget every project.** Set `<TargetFramework>net10.0</TargetFramework>` (or each entry of
   `<TargetFrameworks>`) in every `.csproj`, including test projects. If a `global.json` pins the SDK, set it to a
   10.0 SDK (`aspnetcore-migrate-9-to-10`, "Update the .NET SDK version in global.json").
3. **Update Microsoft packages to 10.0.** Every `Microsoft.AspNetCore.*`, `Microsoft.Extensions.*` and
   `Microsoft.EntityFrameworkCore.*` reference goes from 9.0.x to the latest stable 10.0.x patch, the same patch as
   the runtime in the .NET 10 SDK you build with (`aspnetcore-migrate-9-to-10`, "Update package references").
   Leave other packages alone unless the build fails on them.
4. **Remove `public partial class Program { }`.** ASP.NET Core 10 makes the generated `Program` class public, so
   the declaration added for `WebApplicationFactory<Program>` is no longer needed; the analyzer reports it as
   ASP0027. Integration tests keep working without it.
5. **Update build images and docs.** Replace `mcr.microsoft.com/dotnet/sdk:9.0` (and `aspnet:9.0` runtime images)
   with the 10.0 images in Dockerfiles, CI files and READMEs.
6. **Build with warnings as errors** in the .NET 10 SDK. For every new warning or error, find its entry in
   `dotnet-10-compat` (the .NET 10 breaking changes) and fix it the way that entry says.
7. **Check.** `aisdlc eval` again: the same tests pass, and SonarQube reports no issue that was not there before.

Not needed for a Razor Pages app with cookie sign-in, so not part of this skill: the Blazor items of the ASP.NET Core
migration article (WebAssembly environment, boot configuration, navigation errors).

## Official documentation

Read the part of these pages a step points to. If a page is not in the local docs, ask the engineer to approve
its download (`aisdlc docs request <id>`); never migrate without it.

- `dotnet-9-overview` (dotnet 9): https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-9/overview
- `dotnet-9-compat` (dotnet 9): https://learn.microsoft.com/en-us/dotnet/core/compatibility/9.0
- `aspnetcore-migrate-9-to-10` (aspnetcore 10): https://learn.microsoft.com/en-us/aspnet/core/migration/90-to-100
- `dotnet-10-compat` (dotnet 10): https://learn.microsoft.com/en-us/dotnet/core/compatibility/10

## Done when

Every gate that passed before the migration passes after it, with the same tests: run `aisdlc eval` on the
migrated solution. These were the results when this skill was made:

| Gate | Result | Details |
|---|---|---|
| xunit | passed | 21/21 passed |
| vitest | skipped | skipped: vitest is not installed in the workspace |
| angular | skipped | skipped: no angular.json |
| sonar | passed | quality gate OK; coverage=0.0, bugs=0, code_smells=0, duplicated_lines_density=0.0, vulnerabilities=2, security_hotspots=0 |

Passing the same tests is necessary, not sufficient. Where the repository has sample inputs (test data, recorded
requests, fixture files), run them through the code before and after the migration: the output must match. A sample
whose output changed goes back to the engineer, even when every test passes. Without samples, say so in the summary.

## Rules

- A step that does not apply to this repository is skipped, and the summary says why.
- Anything this skill does not cover goes back to the engineer: run `aisdlc migrate` for a grounded plan instead.
