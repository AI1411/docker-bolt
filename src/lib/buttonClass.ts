export type ButtonVariant = "primary" | "ghost" | "danger";

export function buttonClass(variant: ButtonVariant): string {
  return variant;
}
