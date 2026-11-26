import { readdirSync } from "node:fs";

const DOTNET_PROJECT = /\.(slnx?|csproj)$/i;

/** True when the top folder of the workspace holds a .NET solution or project file. */
export function hasDotnetProject(workspace: string): boolean {
  return readdirSync(workspace).some((f) => DOTNET_PROJECT.test(f));
}
