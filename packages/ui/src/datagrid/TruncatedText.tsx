"use client";
import Tooltip from "@mui/material/Tooltip";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";

/** UX-02: text either wraps or is truncated with an ellipsis plus a full-text tooltip; never clipped bare. */
export const ellipsisStyle: CSSProperties = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};
export const wrapStyle: CSSProperties = {
  display: "block",
  overflowWrap: "anywhere",
  whiteSpace: "normal",
  minWidth: 0,
};

export interface TruncatedTextProps {
  children: ReactNode;
  /** Full text for the tooltip; defaults to `children` when it is a string. */
  text?: string | undefined;
  wrap?: boolean;
  align?: "left" | "right";
}

/** The tooltip only opens when the text really is cut (measured on hover, never during render). */
export function TruncatedText({ children, text, wrap, align = "left" }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  const full = text ?? (typeof children === "string" ? children : undefined);
  const style: CSSProperties = { ...(wrap ? wrapStyle : ellipsisStyle), textAlign: align };
  const span = (
    <span
      ref={ref}
      style={style}
      data-truncate={wrap ? "wrap" : "ellipsis"}
      onMouseEnter={() => {
        const el = ref.current;
        setCut(Boolean(el && el.scrollWidth > el.clientWidth));
      }}
    >
      {children}
    </span>
  );
  if (wrap || !full) return span;
  return (
    <Tooltip title={cut ? full : ""} placement="top-start" enterDelay={400}>
      {span}
    </Tooltip>
  );
}
