import type { BatchCategory, Gate, GateHit } from "./cleanup.js";

/** Which paths and lines count as tests, dependencies or security-sensitive code. Comes from `config/cleanup.yaml`. */
export interface GatePatterns {
  testFiles: RegExp[];
  dependencyFiles: RegExp[];
  securityFiles: RegExp[];
  securityContent: RegExp[];
}

interface FileChange {
  path: string;
  isNew: boolean;
  changedLines: string[];
}

/**
 * Reads a unified diff and decides which human gates apply. It is plain code on purpose: the model writes the
 * change, but it does not get to say whether a human needs to see it.
 *
 * Not gated: removing dead code, and renaming or changing public members (C#) or exports (TS). Behaviour changes
 * show up as failing tests, which the comparison with the reference treats as a regression.
 */
export class DiffClassifier {
  constructor(private readonly patterns: GatePatterns) {}

  classify(diff: string, category: BatchCategory): GateHit[] {
    const changes = parseDiff(diff);
    const hits: GateHit[] = [];
    const add = (gate: Gate, files: string[]) => {
      if (files.length) hits.push({ gate, files: [...new Set(files)] });
    };

    // A new test is welcome; changing or deleting an existing one needs a human.
    add("tests", changes.filter((c) => !c.isNew && matchesAny(c.path, this.patterns.testFiles)).map((c) => c.path));
    add("dependency", changes.filter((c) => matchesAny(c.path, this.patterns.dependencyFiles)).map((c) => c.path));
    add("security", changes
      .filter((c) => category === "security"
        || matchesAny(c.path, this.patterns.securityFiles)
        || c.changedLines.some((line) => matchesAny(line, this.patterns.securityContent)))
      .map((c) => c.path));
    return hits;
  }
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function parseDiff(diff: string): FileChange[] {
  const changes: FileChange[] = [];
  let current: FileChange | undefined;
  for (const line of diff.split(/\r?\n/)) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2]!, isNew: false, changedLines: [] };
      changes.push(current);
    } else if (!current) {
      continue;
    } else if (line.startsWith("new file mode")) {
      current.isNew = true;
    } else if (line.startsWith("deleted file mode")) {
      // A deleted file keeps its old path, which is the one the header already names.
    } else if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) {
      current.changedLines.push(line.slice(1));
    }
  }
  return changes;
}
