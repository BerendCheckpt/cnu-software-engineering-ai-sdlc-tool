import { z } from "zod";
import type { DocSource } from "../../../domain/interfaces/docs/DocSource.js";
import type { ISourceCatalog } from "../../../ports/interfaces/docs/ISourceCatalog.js";
import { loadYaml } from "../../helpers/config/loadYaml.js";

const Manifest = z.object({
  allowedHosts: z.array(z.string()),
  repositoryHosts: z.array(z.string()),
  sources: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    framework: z.string().regex(/^[a-z0-9-]+$/),
    version: z.coerce.string().regex(/^[a-z0-9.-]+$/),
    url: z.url(),
  })),
});

/** Reads `config/sources.yaml`. The schema check also keeps ids safe to use as file names. */
export class YamlSourceCatalog implements ISourceCatalog {
  private readonly manifest: z.infer<typeof Manifest>;

  constructor(file: string) {
    this.manifest = loadYaml(file, Manifest);
  }

  docHosts(): string[] {
    return this.manifest.allowedHosts;
  }

  repositoryHosts(): string[] {
    return this.manifest.repositoryHosts;
  }

  find(sourceId: string): DocSource | undefined {
    return this.manifest.sources.find((s) => s.id === sourceId);
  }

  all(): DocSource[] {
    return [...this.manifest.sources];
  }
}
