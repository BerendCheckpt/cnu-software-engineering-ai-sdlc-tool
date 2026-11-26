import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The folder convention of `src/` (ADR 0013), checked on every test run:
 * `src/<layer>/<kind>/<feature>/<Name>.ts`, one exported declaration per file, named after it, and each layer
 * imports only the layers below it.
 */
const SRC = path.resolve(import.meta.dirname, "../src");

const LAYERS = ["adapters", "application", "domain", "infrastructure", "ports", "shared"] as const;
type Layer = (typeof LAYERS)[number];

/** What each layer may import, besides itself. `shared` imports nothing from the others. */
const ALLOWED: Record<Layer, Layer[]> = {
  shared: [],
  domain: ["shared"],
  ports: ["domain", "shared"],
  application: ["ports", "domain", "shared"],
  infrastructure: ["ports", "domain", "shared"],
  adapters: ["application", "infrastructure", "ports", "domain", "shared"],
};

/** Entry points whose path is part of the package (bin, exports, .mcp.json, skills); they wire, not declare. */
const ENTRY_POINTS = new Set([
  "adapters/composition.ts",
  "adapters/cli/main.ts",
  "adapters/mcp/main.ts",
  "adapters/gateway/main.ts",
  "adapters/frontdoor/index.ts",
]);

type Kind = "classes" | "interfaces" | "types" | "constants" | "helpers";
const KINDS: Kind[] = ["classes", "interfaces", "types", "constants", "helpers"];

interface SourceFile {
  rel: string;
  layer: Layer;
  sf: ts.SourceFile;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []);
}

const files: SourceFile[] = listFiles(SRC).map((abs) => {
  const rel = path.relative(SRC, abs).split(path.sep).join("/");
  return { rel, layer: rel.split("/")[0] as Layer, sf: ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true) };
});

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

function kindOf(node: ts.Statement): Kind | "other" {
  if (ts.isClassDeclaration(node)) return "classes";
  if (ts.isInterfaceDeclaration(node)) return "interfaces";
  if (ts.isTypeAliasDeclaration(node)) return "types";
  if (ts.isFunctionDeclaration(node)) return "helpers";
  if (ts.isVariableStatement(node)) {
    const init = node.declarationList.declarations[0]?.initializer;
    return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? "helpers" : "constants";
  }
  return "other";
}

function namesOf(node: ts.Statement): string[] {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.map((d) => d.name.getText());
  const name = (node as { name?: ts.Identifier }).name;
  return name ? [name.text] : [];
}

describe("src folder convention", () => {
  it("puts every file in a layer", () => {
    expect(files.filter((f) => !LAYERS.includes(f.layer)).map((f) => f.rel)).toEqual([]);
  });

  it("places every file at <layer>/<kind>/<feature>/<Name>.ts, except the entry points", () => {
    const misplaced = files
      .filter((f) => !ENTRY_POINTS.has(f.rel))
      .filter((f) => {
        const parts = f.rel.split("/");
        return parts.length !== 4 || !KINDS.includes(parts[1] as Kind);
      })
      .map((f) => f.rel);
    expect(misplaced).toEqual([]);
  });

  it("gives every file exactly one export, of its folder's kind, named like the file", () => {
    const problems: string[] = [];
    for (const f of files.filter((f) => !ENTRY_POINTS.has(f.rel))) {
      const kind = f.rel.split("/")[1] as Kind;
      const fileName = path.basename(f.rel, ".ts");
      const reExports = f.sf.statements.filter(ts.isExportDeclaration);
      if (reExports.length) problems.push(`${f.rel}: re-exports; import from the declaring file instead`);
      const exported = f.sf.statements.filter(isExported);
      const names = exported.flatMap(namesOf);
      if (names.length !== 1) {
        problems.push(`${f.rel}: ${names.length} exports (${names.join(", ")}), expected 1`);
        continue;
      }
      const actual = kindOf(exported[0]!);
      if (actual !== kind) problems.push(`${f.rel}: exports a ${actual} declaration, but sits in ${kind}/`);
      if (names[0] !== fileName) problems.push(`${f.rel}: exports ${names[0]}, but the file is named ${fileName}`);
    }
    expect(problems).toEqual([]);
  });

  it("imports only from the layers below", () => {
    const problems: string[] = [];
    for (const f of files) {
      for (const node of f.sf.statements) {
        if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
        const spec = (node.moduleSpecifier as ts.StringLiteral).text;
        if (!spec.startsWith(".")) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(f.rel), spec));
        const layer = target.split("/")[0] as Layer;
        if (layer !== f.layer && !ALLOWED[f.layer].includes(layer)) problems.push(`${f.rel} imports ${target}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
