/**
 * `DD-MM-YYYY-HHmmss` in local time: the time part of session and branch names, so several runs on one day each
 * get their own branch.
 */
export function timeStamp(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(now.getDate())}-${two(now.getMonth() + 1)}-${now.getFullYear()}-` +
    `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}
