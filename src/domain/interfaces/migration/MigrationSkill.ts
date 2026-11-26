/** A migration that has been done, evaluated and accepted, and is now a reusable skill. */
export interface MigrationSkill {
  from: string;
  to: string;
  skillPath: string;
}
