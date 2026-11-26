import { SESSION } from "../../constants/progress/SESSION.js";

export function isSessionName(name: string): boolean {
  return SESSION.test(name);
}
