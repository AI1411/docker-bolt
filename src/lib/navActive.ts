export function containersNavActive(pathname: string): boolean {
  if (pathname === "/") return true;
  return /^\/containers\/[^/]+\/logs\/?$/.test(pathname);
}

export function navCount(connected: boolean, loading: boolean, count: number): number | null {
  if (!connected || loading) return null;
  return count;
}
