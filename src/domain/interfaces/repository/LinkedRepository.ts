/**
 * A git folder the engineer already pulled, used where a mirror would be. aisdlc only reads it: changes are made in
 * copies under `work/`, so the folder, its branch and its uncommitted files stay as they are.
 */
export interface LinkedRepository {
  name: string;
  path: string;
  linkedAt: string;
}
