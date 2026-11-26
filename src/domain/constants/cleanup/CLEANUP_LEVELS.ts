/**
 * Which SonarQube findings a clean-up must fix, chosen when it starts: `verbose` every severity, `medium` MEDIUM and
 * above, `high` HIGH and BLOCKER. Findings of other tools (secrets, vulnerable dependencies) are always required.
 */
export const CLEANUP_LEVELS = ["verbose", "medium", "high"] as const;
