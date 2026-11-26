import path from "node:path";
import { MOUNT } from "../../constants/process/MOUNT.js";

/** Rewrites a host path inside the mounted folder, also inside `--option=<path>`, to its path under `/work`. */
export function toContainerPath(arg: string, cwd: string): string {
  const root = path.resolve(cwd);
  const at = process.platform === "win32" ? arg.toLowerCase().indexOf(root.toLowerCase()) : arg.indexOf(root);
  if (at < 0) return arg;
  const rest = arg.slice(at + root.length);
  if (rest && !/^[\\/]/.test(rest)) return arg;
  return `${arg.slice(0, at)}${MOUNT}${rest.replaceAll("\\", "/")}`;
}
