/** Text made safe for a file or folder name: every run of other characters becomes one `-`. */
export function slugify(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, "-");
}
