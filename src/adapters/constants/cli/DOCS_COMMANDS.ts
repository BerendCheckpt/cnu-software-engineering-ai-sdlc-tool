import { TextRenderer } from "../../classes/render/TextRenderer.js";
import type { CliCommand } from "../../interfaces/cli/CliCommand.js";

const renderer = new TextRenderer();

/** The local copy of the official documentation. */
export const DOCS_COMMANDS: CliCommand[] = [
  {
    name: "docs",
    usage: "docs list | docs request <id...> | docs request --all | docs search \"<q>\" [--framework f] | docs reindex",
    run: (app, args) => {
      const [action, ...rest] = args.positionals;
      if (action === "list") {
        return app.sources.all().map((s) => `${app.hasDocs(s.id) ? "[x]" : "[ ]"} ${s.id} (${s.framework} ${s.version})`).join("\n");
      }
      if (action === "request") {
        const ids = args.options.all !== undefined ? app.sources.all().map((s) => s.id) : rest;
        return ids.map((id) => {
          const result = app.requestDocs.execute(id, "requested by an engineer");
          return result.kind === "requested" ? renderer.approval(result.approval) : `${id}: ${result.kind}`;
        }).join("\n");
      }
      if (action === "search") {
        return renderer.chunks(app.searchDocs.execute(rest.join(" "), args.options.framework, args.options.version));
      }
      if (action === "reindex") {
        const { reindexed, notArchived, failed } = app.reindexDocs.execute();
        return [
          ...reindexed.map((r) => `${r.id}: ${r.chunks} sections`),
          ...notArchived.map((id) => `${id}: not archived, download it again to change its sections`),
          ...failed.map((f) => `${f.id}: failed: ${f.error}`),
        ].join("\n") || "No downloaded docs to reindex.";
      }
      throw new Error("Use: docs list | docs request | docs search | docs reindex");
    },
  },
];
