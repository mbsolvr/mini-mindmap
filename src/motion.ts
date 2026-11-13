export function captureNodePositions(map: HTMLElement) {
  return new Map(
    Array.from(
      map.querySelectorAll<HTMLElement>("[data-drop-key]"),
      (element) => {
        const { left, top } = element.getBoundingClientRect();
        return [element.dataset.dropKey, { left, top }];
      },
    ),
  );
}

export function nodeOffset(
  before: { left: number; top: number },
  after: { left: number; top: number },
  zoom: number,
) {
  return {
    x: (before.left - after.left) / zoom,
    y: (before.top - after.top) / zoom,
  };
}

export function animateNodePositions(
  map: HTMLElement,
  before: Map<string | undefined, { left: number; top: number }>,
  zoom: number,
) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return [];
  const animations = [];
  for (const element of map.querySelectorAll<HTMLElement>("[data-drop-key]")) {
    const previous = before.get(element.dataset.dropKey);
    if (!previous) continue;
    const offset = nodeOffset(previous, element.getBoundingClientRect(), zoom);
    if (Math.abs(offset.x) < 0.5 && Math.abs(offset.y) < 0.5) continue;
    const animation = element.animate(
      [
        { transform: `translate(${offset.x}px, ${offset.y}px)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: 220, easing: "cubic-bezier(.2, .7, .2, 1)" },
    );
    animation.id = "node-move";
    animations.push(animation);
  }
  return animations;
}
