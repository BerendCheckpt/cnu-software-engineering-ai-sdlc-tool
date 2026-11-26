import path from "node:path";

/** The program a command runs, without its folder or a Windows `.exe`/`.cmd` extension. */
export function programName(command: string): string {
  return path.basename(command).replace(/\.(exe|cmd)$/i, "");
}
