import type { CSSProperties } from "react";
import type { TextStyle } from "./types.ts";

export function textStyleCss(style: TextStyle | undefined): CSSProperties {
  return {
    color: style?.color || undefined,
    fontWeight: style?.bold ? "bold" : undefined,
    fontStyle: style?.italic ? "italic" : undefined,
    textDecoration: style?.underline ? "underline" : undefined,
    fontSize: style?.size ? `${style.size}px` : undefined,
  };
}
