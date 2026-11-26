import type { FixLoop } from "../../../domain/classes/quality/FixLoop.js";

export interface IFixLoopStore {
  save(loop: FixLoop): void;
  get(subject: string): FixLoop | undefined;
}
