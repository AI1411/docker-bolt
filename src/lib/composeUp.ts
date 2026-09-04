export function composeUpCancelled(
  path: string | null | undefined,
): path is null | undefined | "" {
  return !path;
}
