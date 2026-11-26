# ADR 0013: One declaration per file, grouped by kind then feature; duplicates live once in `src/shared`

- **Status:** Accepted
- **Date:** 2026-11-26

## Context
The layer folders were clear, but the files in them were not. `application/cleanup.ts` held 11 classes, 7
interfaces and 5 functions; `ports/services.ts` held 28 interfaces; the CLI command list was one 290-line array.
To find a class you had to know which file it was in, and a change to one use case touched a file shared by ten.
Small helpers (escaping a Markdown table cell, `file:line`, the first line of a tool's output) were written
again in every file that needed them.

## Decision
- **Path.** Every source file is `src/<layer>/<kind>/<feature>/<Name>.ts`. The kinds are `classes`, `interfaces`,
  `types` (type aliases and unions), `constants` (exported values: lists, regexes, schemas) and `helpers`
  (stand-alone functions). The feature is the concept (`cleanup`, `docs`, `git`, `sqlite`, ...). Infrastructure
  keeps its technology folders as features.
- **One export per file**, named exactly like the file. A function or constant that only one file uses stays in
  that file, unexported. When two files need it, it gets its own file.
- **No barrels.** Every import names the file that declares the symbol.
- **Entry points stay where they are**, because `package.json`, `.mcp.json` and the skills refer to their `dist`
  paths: `adapters/{cli,mcp,gateway}/main.ts`, `adapters/frontdoor/index.ts` (a re-export of the front door) and
  `adapters/composition.ts`.
- **`src/shared`** holds code that was duplicated across files and needs no layer's types. It imports nothing
  from the other layers, so the domain may use it. A duplicate that needs a layer's types (`requireSolution`, the
  sqlite `Row`) is merged inside that layer instead. Copies that behave differently (different lengths, wording,
  or error handling) are left apart: merging them would change output.
- **Layer rule**, now including shared: shared → nothing; domain → shared; ports → domain, shared; application →
  ports, domain, shared; infrastructure → ports, domain, shared; adapters → everything.

`test/architecture.test.ts` checks the path, the one-export rule, the file names and the layer rule on every
test run.

## Consequences
- A class, interface or helper is found by its name; a change to one use case touches its own file.
- There are many more files (about 330), and import lists are longer.
- `ISkillWriter` and `SkillContent` moved from application to ports: infrastructure implemented them, which was
  the one import from infrastructure into application.
