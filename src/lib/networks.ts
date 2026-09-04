export function isSystemNetwork(name: string): boolean {
  return name === "bridge" || name === "host" || name === "none";
}
