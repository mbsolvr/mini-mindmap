import React, { useEffect, useState } from "react";
import { relationCurve } from "../relations.ts";

export default function RelationGuide({
  mapRef,
  source,
}: {
  mapRef: React.RefObject<HTMLElement | null>;
  source: string | null;
}) {
  const [path, setPath] = useState("");
  useEffect(() => {
    setPath("");
    if (!source) return;
    function move(event: PointerEvent) {
      const card = Array.from(
        (mapRef.current?.querySelectorAll("[data-drop-key]") ||
          []) as NodeListOf<HTMLElement>,
      ).find((item) => item.dataset.dropKey === source);
      if (!card) {
        setPath("");
        return;
      }
      const r = card.getBoundingClientRect();
      setPath(
        relationCurve(
          { x: r.left, y: r.top, width: r.width, height: r.height },
          { x: event.clientX, y: event.clientY, width: 0, height: 0 },
        ).d,
      );
    }
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [source, mapRef]);
  return source && path ? (
    <svg className="relation-guide" aria-hidden="true">
      <path d={path} />
    </svg>
  ) : null;
}
