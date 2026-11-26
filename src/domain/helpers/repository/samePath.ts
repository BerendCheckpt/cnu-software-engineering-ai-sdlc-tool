import path from "node:path";

/** The same folder, however it was written. Windows paths are compared without case. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const normal = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return platform === "win32" ? normal(a).toLowerCase() === normal(b).toLowerCase() : normal(a) === normal(b);
}
