import { OPTIONS } from "./OPTIONS.js";

/** Every option the commands know, for completion. */
export const OPTION_NAMES = [...OPTIONS, "all"].map((o) => `--${o}`);
