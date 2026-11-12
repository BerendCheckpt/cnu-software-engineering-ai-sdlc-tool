/** Where a question stands, in the words Shiva's `QUESTIONS.md` index uses. */
export type QuestionStatus = "answered" | "blocking" | "needs-attention" | "skipped";

/** One question a human has to answer before a migration can go on. */
export interface OpenQuestion {
  /** `Q1`, `Q2`, ... */
  id: string;
  status: QuestionStatus;
  /** The finding, not the question: what is known and what is still open. */
  topic: string;
  /** The status cell as written, when it was not one of the four status words and had to be mapped. */
  rawStatus?: string;
}

export type QuestionIndexResult =
  | { kind: "index"; questions: OpenQuestion[] }
  /** Not the table format: never read as "nothing open". */
  | { kind: "unrecognised"; reason: string };

/** Status words as written in the table, with the marker each one gets. */
const STATUS_WORDS: { status: QuestionStatus; word: string; mark: string }[] = [
  { status: "answered", word: "ANSWERED", mark: "✅" },
  { status: "blocking", word: "BLOCKING", mark: "⛔" },
  { status: "needs-attention", word: "NEEDS ATTENTION", mark: "⚠️" },
  { status: "skipped", word: "SKIPPED", mark: "⏭️" },
];

/**
 * Other words older `QUESTIONS.md` files start a status with, as found in the plugin repos on 2026-11-12. A cell is
 * read by its leading word only: "HALF ANSWERED" or "PARTLY ANSWERED" is not answered.
 */
const KNOWN_WORDS: { word: string; status: QuestionStatus }[] = [
  { word: "DONE", status: "answered" },
  { word: "DECIDED", status: "answered" },
  { word: "PORTED", status: "answered" },
  { word: "VERIFIED", status: "answered" },
  { word: "CLOSED", status: "skipped" },
  { word: "NOT REQUIRED", status: "skipped" },
  { word: "DEFERRED", status: "skipped" },
  { word: "INFORMATIONAL", status: "skipped" },
  { word: "OPEN", status: "needs-attention" },
  { word: "ASKED", status: "needs-attention" },
  { word: "CONFIRM", status: "needs-attention" },
  { word: "SIGN-OFF", status: "needs-attention" },
  { word: "PARTLY", status: "needs-attention" },
  { word: "HALF", status: "needs-attention" },
  { word: "PART", status: "needs-attention" },
];

/** `Q1`, or `A1` in files that number answers apart. */
const QUESTION_ID = /\b([QA])(\d+)\b/i;

/**
 * The question index of a migration: the `| # | Status | Topic |` table that Shiva writes at the top of
 * `QUESTIONS.md`, and that aisdlc writes in its own plans. The table is authoritative for status.
 */
export class QuestionIndex {
  /** Reads the first index table. Older Shiva formats name the status column `Blocking`; both are read. */
  static parse(markdown: string): QuestionIndexResult {
    const lines = markdown.split(/\r?\n/);
    const header = lines.findIndex((l) => isIndexHeader(cells(l)));
    if (header < 0) return { kind: "unrecognised", reason: "no | # | Status | Topic | table" };

    const questions: OpenQuestion[] = [];
    for (const line of lines.slice(header + 2)) {
      if (!line.trim().startsWith("|")) break;
      const [idCell = "", statusCell = "", ...rest] = cells(line);
      const id = QUESTION_ID.exec(idCell);
      if (!id) return { kind: "unrecognised", reason: `row without a question id: ${line.trim()}` };
      const { status, mapped } = statusOf(statusCell);
      questions.push({
        id: `${id[1]!.toUpperCase()}${id[2]}`,
        status,
        topic: rest.join(" | ").trim(),
        ...(mapped ? { rawStatus: statusCell } : {}),
      });
    }
    return { kind: "index", questions };
  }

  /** The same table, so one parser reads both Shiva's questions and aisdlc's. */
  static render(questions: OpenQuestion[]): string[] {
    return [
      "| # | Status | Topic |",
      "|---|---|---|",
      ...questions.map((q) => {
        const s = STATUS_WORDS.find((w) => w.status === q.status)!;
        return `| ${q.id} | ${s.mark} **${s.word}** | ${q.topic.replaceAll("|", "\\|")} |`;
      }),
    ];
  }

  /** Questions that stop a migration until a human answers them. */
  static open(questions: OpenQuestion[]): OpenQuestion[] {
    return questions.filter((q) => q.status === "blocking" || q.status === "needs-attention");
  }
}

/** The cells of a table row, without the outer pipes; an escaped `\|` stays in its cell. */
function cells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return [];
  return trimmed.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replaceAll("\\|", "|"));
}

function isIndexHeader(row: string[]): boolean {
  const [id, status, topic] = row.map((c) => c.toLowerCase());
  return row.length === 3 && id === "#" && (status === "status" || status === "blocking") && topic === "topic";
}

/**
 * The status by the cell's leading word: one of the four status words, else a known older word. Any other word, or
 * an empty cell, counts as needing attention, so a status nobody can read never looks answered.
 */
function statusOf(cell: string): { status: QuestionStatus; mapped: boolean } {
  // Leading markers and markup (emoji such as ℹ, which Unicode calls a letter, `**`, `_`) are not part of the word.
  const text = cell.toUpperCase().replace(/^[^A-Z]+/, "");
  const starts = (word: string) => text.startsWith(word) && !/^[A-Z-]/.test(text.slice(word.length));
  const exact = STATUS_WORDS.find((w) => starts(w.word));
  if (exact) return { status: exact.status, mapped: false };
  return { status: KNOWN_WORDS.find((w) => starts(w.word))?.status ?? "needs-attention", mapped: true };
}
