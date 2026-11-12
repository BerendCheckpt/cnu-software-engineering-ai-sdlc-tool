import { describe, expect, it } from "vitest";
import { type OpenQuestion, QuestionIndex } from "../src/domain/openQuestion.js";

// The formats Shiva writes in docs/conversion/QUESTIONS.md, trimmed to their shape.
const STATUS_FORMAT = `# Conversion questions

## Index

Status: ✅ **ANSWERED** · ⛔ **BLOCKING** · ⚠️ **NEEDS ATTENTION** · ⏭️ **SKIPPED**

| # | Status | Topic |
|---|---|---|
| [Q1](#q1-no-real-sample-files) | ⛔ **BLOCKING** (needs Prod access) | No real sample files; all fixtures are synthetic. |
| [Q2](#q2-grain) | ✅ **ANSWERED** | Grain inferred from the JSON nesting. |
| [Q3](#q3-cut-number) | ⚠️ **Needs attention** | Cut number source not confirmed. |
| [Q4](#q4-lookup) | ⏭️ **SKIPPED** | Lookup migration done by hand. |

## Q1: No real sample files
`;

const BLOCKING_COLUMN = `## Index

| # | Blocking | Topic |
|---|---|---|
| [Q1](#q1-lookup-migration) | ✅ **ANSWERED** | Migrated: 7 categories, 1,420 rows. |
`;

describe("QuestionIndex", () => {
  it("reads Shiva's index with the status column, extra text and any case", () => {
    expect(QuestionIndex.parse(STATUS_FORMAT)).toEqual({
      kind: "index",
      questions: [
        { id: "Q1", status: "blocking", topic: "No real sample files; all fixtures are synthetic." },
        { id: "Q2", status: "answered", topic: "Grain inferred from the JSON nesting." },
        { id: "Q3", status: "needs-attention", topic: "Cut number source not confirmed." },
        { id: "Q4", status: "skipped", topic: "Lookup migration done by hand." },
      ],
    });
  });

  it("reads the older format that names the status column Blocking", () => {
    expect(QuestionIndex.parse(BLOCKING_COLUMN)).toEqual({
      kind: "index",
      questions: [{ id: "Q1", status: "answered", topic: "Migrated: 7 categories, 1,420 rows." }],
    });
  });

  const statuses = (rows: string[]) => {
    const parsed = QuestionIndex.parse(["| # | Status | Topic |", "|---|---|---|", ...rows].join("\n"));
    if (parsed.kind !== "index") throw new Error(parsed.reason);
    return parsed.questions.map((q) => [q.id, q.status, q.rawStatus]);
  };

  it("maps the older status words by the cell's leading word, and keeps the cell as written", () => {
    expect(statuses([
      "| Q1 | open | a |",
      "| Q2 | ✅ **DONE** | b |",
      "| Q3 | ✅ **DECIDED** — keep legacy | c |",
      "| Q4 | ✅ Closed — scoped out | d |",
      "| Q5 | ℹ️ Informational | e |",
      "| Q6 | **PORTED** as legacy | f |",
      "| Q7 | Not required — developer | g |",
    ])).toEqual([
      ["Q1", "needs-attention", "open"],
      ["Q2", "answered", "✅ **DONE**"],
      ["Q3", "answered", "✅ **DECIDED** — keep legacy"],
      ["Q4", "skipped", "✅ Closed — scoped out"],
      ["Q5", "skipped", "ℹ️ Informational"],
      ["Q6", "answered", "**PORTED** as legacy"],
      ["Q7", "skipped", "Not required — developer"],
    ]);
  });

  it("does not read a partial answer as answered", () => {
    expect(statuses(["| Q1 | Half answered | a |", "| Q2 | Partly answered: Prod OrgID | b |", "| Q3 | Part done, part waiting | c |"])
      .map(([, status]) => status)).toEqual(["needs-attention", "needs-attention", "needs-attention"]);
  });

  it("never reads an unknown word or an empty status as nothing open", () => {
    expect(statuses(["| Q1 | Wrong | a |", "| Q2 |  | b |"])).toEqual([
      ["Q1", "needs-attention", "Wrong"],
      ["Q2", "needs-attention", ""],
    ]);
  });

  it("reads answer ids such as A1, and refuses a row without an id", () => {
    expect(statuses(["| [A1](#a1-feed) | ✅ **ANSWERED** | a |"])).toEqual([["A1", "answered", undefined]]);
    expect(QuestionIndex.parse("| # | Status | Topic |\n|---|---|---|\n| see below | open | a |\n"))
      .toMatchObject({ kind: "unrecognised", reason: expect.stringContaining("without a question id") });
  });

  it("reports a file without an index table", () => {
    expect(QuestionIndex.parse("# Questions\n\n1. Where do lookups come from?\n"))
      .toEqual({ kind: "unrecognised", reason: "no | # | Status | Topic | table" });
  });

  it("writes a table it reads back, with a pipe in a topic", () => {
    const questions: OpenQuestion[] = [
      { id: "Q1", status: "needs-attention", topic: "Use A | B?" },
      { id: "Q2", status: "answered", topic: "Done." },
    ];
    expect(QuestionIndex.parse(QuestionIndex.render(questions).join("\n"))).toEqual({ kind: "index", questions });
  });

  it("counts blocking and needs-attention questions as open", () => {
    const parsed = QuestionIndex.parse(STATUS_FORMAT);
    if (parsed.kind !== "index") throw new Error("expected an index");
    expect(QuestionIndex.open(parsed.questions).map((q) => q.id)).toEqual(["Q1", "Q3"]);
  });
});
