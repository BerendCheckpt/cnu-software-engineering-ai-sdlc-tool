/** Inside a container `localhost` is the container itself; this machine is `host.docker.internal`. */
export function reachableFromContainer(url: string): string {
  const parsed = new URL(url);
  if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) parsed.hostname = "host.docker.internal";
  return parsed.href.replace(/\/$/, "");
}
