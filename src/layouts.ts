export const layouts = [
  ["mindmap", "Mind map"],
  ["logic", "Logic Chart (Right)"],
  ["reverse", "Logic Chart (Left)"],
  ["org", "Org Chart"],
  ["fishbone", "Fishbone (Right)"],
  ["reverse-fishbone", "Fishbone (Left)"],
];
export function resolveLayout(layout: string | undefined): string {
  return layout && layouts.some(([key]) => key === layout) ? layout : "mindmap";
}
