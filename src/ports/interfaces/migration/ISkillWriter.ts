import type { SkillContent } from "./SkillContent.js";

/** Renders a crystallized migration skill from a fixed template. */
export interface ISkillWriter {
  render(content: SkillContent): string;
}
