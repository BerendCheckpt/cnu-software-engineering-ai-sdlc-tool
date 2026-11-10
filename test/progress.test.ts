import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CleanupBatch, CleanupRun, type Finding } from "../src/domain/cleanup.js";
import { dayStamp, sessionName } from "../src/domain/progress.js";
import { bySeverity } from "../src/domain/quality.js";
import { ProgressHub, SessionLog, TerminalProgress } from "../src/infrastructure/progress/progress.js";
import { CleanupReportWriter } from "../src/infrastructure/reporting/cleanupReportWriter.js";
import { tempDir } from "./helpers.js";

describe("session names", () => {
  const now = new Date(2026, 10, 9);

  it("uses the given name, else <command>-<run_id>-DD-MM-YYYY, else <command>-DD-MM-YYYY", () => {
    expect(dayStamp(now)).toBe("09-11-2026");
    expect(sessionName("cleanup", { given: "aisdlc-cleanup-09-11-2026", runId: "6ad39600" }, now)).toBe("aisdlc-cleanup-09-11-2026");
    expect(sessionName("cleanup", { runId: "6ad39600" }, now)).toBe("cleanup-6ad39600-09-11-2026");
    expect(sessionName("docs", {}, now)).toBe("docs-09-11-2026");
    expect(() => sessionName("cleanup", { given: "../evil" }, now)).toThrow(/Not a valid session name/);
  });
});

describe("progress", () => {
  it("fans out to every listener, keeps going when one fails, and stops after detach", () => {
    const hub = new ProgressHub();
    const seen: string[] = [];
    hub.attach({ write: () => { throw new Error("disk full"); } });
    const detach = hub.attach({ write: (e) => { seen.push(`${e.session} ${e.step} ${e.status}`); } });
    hub.begin("s1");
    hub.emit("checkout", "started");
    detach();
    hub.emit("checkout", "done");
    expect(seen).toEqual(["s1 checkout started"]);
  });

  it("writes one log per session that a listener reads incrementally and follows", async () => {
    const log = new SessionLog(tempDir());
    const hub = new ProgressHub();
    hub.attach(log);
    hub.begin("a");
    hub.emit("gate vitest", "done", "3/3 passed");
    hub.begin("b");
    hub.emit("plan", "done");

    const first = log.read("a");
    expect(first.events).toMatchObject([{ session: "a", step: "gate vitest", status: "done", detail: "3/3 passed" }]);
    hub.begin("a");
    hub.emit("findings", "failed");
    expect(log.read("a", first.next).events.map((e) => e.step)).toEqual(["findings"]);
    expect(log.latest()).toBe("a");

    const lines: string[] = [];
    const stop = new AbortController();
    const following = log.follow("a", (l) => lines.push(l), stop.signal, 5);
    await new Promise((r) => setTimeout(r, 20));
    stop.abort();
    await following;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[\d\d:\d\d:\d\d\] ok gate vitest: 3\/3 passed$/);
  });

  it("prints a step on the terminal as one line", () => {
    const out = new PassThrough();
    new TerminalProgress(out).write({ session: "s", at: new Date().toISOString(), step: "push", status: "failed", detail: "denied" });
    expect(String(out.read())).toMatch(/!! push: denied\n$/);
  });
});

describe("the PR body", () => {
  const at = (rule: string, severity: string, category: Finding["category"], source = "sonar", line = 1): Finding =>
    ({ source, rule, category, severity, file: "src/a.ts", line, message: `${rule} here` });

  it("ranks severities, npm's MODERATE as MEDIUM", () => {
    expect(bySeverity([at("a", "LOW", "bug"), at("b", "MODERATE", "dependency"), at("c", "BLOCKER", "bug"), at("d", "CRITICAL", "security")])
      .map((f) => f.rule)).toEqual(["c", "d", "b", "a"]);
  });

  it("lists every security finding with its status and doc, and the changes to review closely", () => {
    const secret = at("generic-api-key", "CRITICAL", "security", "gitleaks", 3);
    const vulnerable = at("lodash", "MODERATE", "dependency", "npm-audit", 4);
    const smell = at("S1135", "MINOR", "maintainability", "sonar", 5);
    const run = CleanupRun.start({ id: "r1", repository: "shop", workspace: "/w", branch: "cleanup/09-11-2026", baseBranch: "main",
      baseline: { gates: [], findings: [secret, vulnerable, smell] } });
    run.acceptMeasurement({ gates: [], findings: [vulnerable] });
    const security = CleanupBatch.plan("r1", 1, "security", [secret]);
    security.start("abc1234");
    security.complete("deadbeef00", [{ gate: "security", files: ["appsettings.json"] }]);
    const maintenance = CleanupBatch.plan("r1", 2, "maintainability", [smell]);
    maintenance.start("deadbeef00");
    maintenance.complete("cafebabe00", []);

    const body = new CleanupReportWriter().report(run, [security, maintenance],
      new Map([["lodash", { heading: "Prototype pollution", url: "https://docs.example/lodash" }]]));
    const section = body.slice(body.indexOf("### Security concerns"), body.indexOf("### Gates"));
    expect(section).toContain("| HIGH | gitleaks | generic-api-key | `src/a.ts:3` | fixed in `deadbeef` | - |");
    expect(section).toContain("| MEDIUM | npm-audit | lodash | `src/a.ts:4` | still open | [Prototype pollution](https://docs.example/lodash) |");
    expect(section).not.toContain("S1135");
    expect(section).toContain("- Batch 1 (security, `deadbeef`): security: `appsettings.json`");
    const changelog = body.slice(body.indexOf("### Changelog"), body.indexOf("### Security concerns"));
    expect(changelog.indexOf("generic-api-key")).toBeLessThan(changelog.indexOf("S1135"));
    expect(changelog).toContain("`deadbeef` ⚠");
  });
});
