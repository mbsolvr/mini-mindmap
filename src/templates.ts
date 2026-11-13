export const templates = [
  ["default", "Default"],
  ["midnight", "Midnight"],
];
export function resolveTemplate(value: string | undefined): string {
  return value && templates.some(([key]) => key === value) ? value : "default";
}
