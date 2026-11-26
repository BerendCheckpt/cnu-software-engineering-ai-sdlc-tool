import type { DocSource } from "../../../domain/interfaces/docs/DocSource.js";
import type { ArchivedPage } from "./ArchivedPage.js";

/** Keeps downloaded pages as read-only files, for humans to open and for audit. */
export interface IDocArchive {
  write(source: DocSource, markdown: string): string;
  /** The page as it was downloaded, or undefined when it is not archived. */
  read(source: DocSource): ArchivedPage | undefined;
}
