import { connectorPath } from "./connector.ts";

const NS = "http://www.w3.org/2000/svg";
const MARGIN = 32;
export function fishboneRibPath(
  x: number,
  spineY: number,
  endY: number,
  rootOnRight: boolean,
): string {
  return `M${x} ${spineY}L${x + (rootOnRight ? 8 : -8)} ${endY}`;
}

export function makeSvg(map: HTMLElement, canvas: HTMLElement, zoom: number) {
  const mapRect = map.getBoundingClientRect();
  const floating = Array.from(
    map.querySelectorAll<HTMLElement>(":scope > .floating-object"),
  );
  const bounds = [
    mapRect,
    ...floating.map((element) => element.getBoundingClientRect()),
    ...Array.from(
      map.querySelectorAll(
        ".relation-line,.relation-label,.summary-group,.summary-node",
      ),
      (element) => element.getBoundingClientRect(),
    ),
  ];
  const left = Math.min(...bounds.map((r) => r.left)),
    top = Math.min(...bounds.map((r) => r.top));
  const right = Math.max(...bounds.map((r) => r.left + r.width)),
    bottom = Math.max(...bounds.map((r) => r.top + r.height));
  const width = Math.ceil((right - left) / zoom) + MARGIN * 2;
  const height = Math.ceil((bottom - top) / zoom) + MARGIN * 2;
  if (width <= MARGIN * 2 || height <= MARGIN * 2)
    throw new Error("Canvas is empty");
  const rect = (element: Element) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: (bounds.left - left) / zoom + MARGIN,
      y: (bounds.top - top) / zoom + MARGIN,
      width: bounds.width / zoom,
      height: bounds.height / zoom,
    };
  };
  const svg = document.createElementNS(NS, "svg");
  function add(
    parent: Element,
    tag: string,
    attributes: Record<string, string | number | null>,
    text?: string | null,
  ) {
    const element = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes))
      element.setAttribute(name, String(value));
    if (text != null) element.textContent = text;
    parent.appendChild(element);
    return element;
  }
  for (const [name, value] of Object.entries({
    xmlns: NS,
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  }))
    svg.setAttribute(name, String(value));
  const canvasStyle = getComputedStyle(canvas);
  const bg =
    canvasStyle.backgroundColor === "rgba(0, 0, 0, 0)"
      ? getComputedStyle(document.documentElement).backgroundColor
      : canvasStyle.backgroundColor;
  const line = canvasStyle.getPropertyValue("--map-line").trim() || "#666";
  const relationColor =
    canvasStyle.getPropertyValue("--map-relation").trim() || "#7aaea6";
  add(svg, "rect", { width, height, fill: bg });
  const lines = add(svg, "g", {
    fill: "none",
    stroke: line,
    "stroke-width": "1",
  });
  const nodes = add(svg, "g", {});
  const baselines = new Map<string, number>();
  function textBaseline(style: CSSStyleDeclaration): number {
    const properties = [
      style.fontFamily,
      style.fontSize,
      style.fontWeight,
      style.fontStyle,
      style.lineHeight,
      style.letterSpacing,
    ];
    const key = JSON.stringify(properties);
    const cached = baselines.get(key);
    if (cached !== undefined) return cached;
    const line = document.createElement("div"),
      marker = document.createElement("span");
    Object.assign(line.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: "max-content",
      margin: "0",
      padding: "0",
      border: "0",
      whiteSpace: "pre",
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
    });
    Object.assign(marker.style, {
      display: "inline-block",
      width: "0",
      height: "0",
      verticalAlign: "baseline",
    });
    line.textContent = "\u200b";
    line.appendChild(marker);
    document.body.appendChild(line);
    const baseline =
      marker.getBoundingClientRect().top - line.getBoundingClientRect().top;
    line.remove();
    baselines.set(key, baseline);
    return baseline;
  }
  function required<T extends Element>(parent: Element, selector: string): T {
    const element = parent.querySelector<T>(selector);
    if (!element)
      throw new Error("The map is incomplete and cannot be exported");
    return element;
  }
  function draw(row: Element) {
    const card = required<HTMLElement>(row, ":scope > .node");
    const cardRect = rect(card);
    const connectorY = (
      element: HTMLElement,
      bounds: ReturnType<typeof rect>,
    ) => {
      const style = getComputedStyle(element);
      return parseFloat(style.borderTopWidth) === 0 &&
        parseFloat(style.borderBottomWidth) > 0
        ? bounds.y + bounds.height - parseFloat(style.borderBottomWidth) / 2
        : bounds.y + bounds.height / 2;
    };
    for (const childGroup of row.querySelectorAll(":scope > .children")) {
      const fishbone =
        row.classList.contains("depth-0") &&
        (map.classList.contains("layout-fishbone") ||
          map.classList.contains("layout-reverse-fishbone"));
      const groupRect = rect(childGroup);
      const spineY = fishbone ? groupRect.y + groupRect.height / 2 : 0;
      const rootOnRight = fishbone && cardRect.x > groupRect.x;
      if (fishbone) {
        add(lines, "path", {
          d: `M${rootOnRight ? groupRect.x : cardRect.x + cardRect.width} ${spineY}H${rootOnRight ? cardRect.x : groupRect.x + groupRect.width}`,
          "stroke-width": 2,
        });
      }
      for (const branch of childGroup.children) {
        const child = required<HTMLElement>(branch, ":scope > .node-row");
        const childCard = required<HTMLElement>(child, ":scope > .node");
        const childRect = rect(childCard);
        if (fishbone) {
          const branchRect = rect(branch),
            childRow = rect(child);
          const x = branchRect.x + branchRect.width / 2;
          const upper = childRow.y + childRow.height / 2 < spineY;
          const endY = upper ? childRow.y + childRow.height : childRow.y;
          add(lines, "path", {
            d: fishboneRibPath(x, spineY, endY, rootOnRight),
          });
        } else if (map.classList.contains("layout-org")) {
          const x1 = cardRect.x + cardRect.width / 2,
            y1 = cardRect.y + cardRect.height;
          const x2 = childRect.x + childRect.width / 2,
            y2 = childRect.y;
          const collapse = row.querySelector<HTMLElement>(":scope > .collapse");
          add(lines, "path", {
            d: connectorPath(
              { x: x1, y: y1 },
              { x: x2, y: y2 },
              true,
              collapse ? rect(collapse) : undefined,
            ),
            "stroke-width": "1pt",
          });
        } else {
          const left =
            childRect.x + childRect.width / 2 < cardRect.x + cardRect.width / 2;
          const start = {
            x: left ? cardRect.x : cardRect.x + cardRect.width,
            y: connectorY(card, cardRect),
          };
          const end = {
            x: left ? childRect.x + childRect.width : childRect.x,
            y: connectorY(childCard, childRect),
          };
          const collapse = row.querySelector<HTMLElement>(":scope > .collapse");
          add(lines, "path", {
            d: connectorPath(
              start,
              end,
              false,
              collapse ? rect(collapse) : undefined,
            ),
            "stroke-width": "1pt",
          });
        }
        draw(child);
      }
    }
    const cardStyle = getComputedStyle(card);
    const bottomWidth = parseFloat(cardStyle.borderBottomWidth);
    if (bottomWidth > 0 && parseFloat(cardStyle.borderTopWidth) === 0) {
      const y = cardRect.y + cardRect.height - bottomWidth / 2;
      add(nodes, "line", {
        x1: cardRect.x,
        y1: y,
        x2: cardRect.x + cardRect.width,
        y2: y,
        stroke: cardStyle.borderBottomColor,
        "stroke-width": bottomWidth,
      });
    } else {
      add(nodes, "rect", {
        x: cardRect.x,
        y: cardRect.y,
        width: cardRect.width,
        height: cardRect.height,
        rx: parseFloat(cardStyle.borderTopLeftRadius) || 0,
        fill: cardStyle.backgroundColor,
        stroke: cardStyle.borderTopColor,
        "stroke-width": parseFloat(cardStyle.borderTopWidth) || 0,
      });
    }
    const image = card.querySelector(":scope > img");
    if (image) {
      const r = rect(image);
      add(nodes, "image", {
        ...r,
        href: image.getAttribute("src"),
        preserveAspectRatio: "xMidYMid meet",
      });
    }
    const input = required<HTMLTextAreaElement>(card, ".node-text textarea");
    if (input.value) {
      const r = rect(input),
        style = getComputedStyle(input);
      const lineHeight =
        parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
      const text = add(nodes, "text", {
        fill: style.color,
        "font-family": style.fontFamily,
        "font-size": style.fontSize,
        "font-weight": style.fontWeight,
        "font-style": style.fontStyle,
        "text-decoration": style.textDecorationLine,
        "xml:space": "preserve",
      });
      input.value
        .split("\n")
        .forEach((line, index) =>
          add(
            text,
            "tspan",
            { x: r.x, y: r.y + textBaseline(style) + lineHeight * index },
            line,
          ),
        );
    }
  }
  draw(required<HTMLElement>(map, ":scope > .node-row"));
  map.querySelectorAll(":scope > .floating-topic > .node-row").forEach(draw);
  map
    .querySelectorAll<HTMLElement>(":scope > .floating-note")
    .forEach((note) => {
      const input = required<HTMLTextAreaElement>(note, "textarea"),
        box = rect(note),
        textRect = rect(input),
        style = getComputedStyle(input),
        noteStyle = getComputedStyle(note);
      add(nodes, "rect", {
        ...box,
        rx: 5,
        fill: noteStyle.backgroundColor,
        stroke: noteStyle.borderTopColor,
        "stroke-width": 1,
      });
      const text = add(nodes, "text", {
        fill: style.color,
        "font-family": style.fontFamily,
        "font-size": style.fontSize,
        "font-weight": style.fontWeight,
        "font-style": style.fontStyle,
        "text-decoration": style.textDecorationLine,
        "dominant-baseline": "central",
        "xml:space": "preserve",
      });
      const measure = document.createElement("canvas").getContext("2d");
      if (!measure) throw new Error("Could not create the image canvas");
      measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const lines: string[] = [];
      for (const paragraph of input.value.split("\n")) {
        let line = "";
        for (const char of paragraph) {
          if (
            line &&
            measure.measureText(line + char).width > textRect.width - 4
          ) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
        lines.push(line);
      }
      const lineHeight =
        parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
      lines.forEach((line, index) =>
        add(
          text,
          "tspan",
          { x: textRect.x, y: textRect.y + lineHeight * (index + 0.5) },
          line,
        ),
      );
    });
  map.querySelectorAll<HTMLElement>(".summary-group").forEach((group) => {
    const bracket = required<HTMLElement>(group, ".summary-bracket");
    const row = required<HTMLElement>(
      group,
      ":scope > .summary-node > .node-row",
    );
    const card = required<HTMLElement>(row, ":scope > .node");
    const b = rect(bracket),
      r = rect(card);
    const left = group.classList.contains("summary-left"),
      bracketStyle = getComputedStyle(bracket),
      bracketEdge = left ? "borderLeft" : "borderRight",
      bracketWidth = parseFloat(bracketStyle[`${bracketEdge}Width`]) || 0,
      edge = left ? b.x : b.x + b.width,
      tip = left ? b.x + b.width : b.x;
    add(lines, "path", {
      d: `M${tip} ${b.y}H${edge}V${b.y + b.height}H${tip}`,
      stroke: bracketStyle[`${bracketEdge}Color`],
      "stroke-width": bracketWidth,
    });
    add(lines, "line", {
      x1: edge,
      y1: b.y + b.height / 2,
      x2: left ? r.x + r.width : r.x,
      y2: b.y + b.height / 2,
      stroke: bracketStyle[`${bracketEdge}Color`],
      "stroke-width": bracketWidth,
    });
    draw(row);
  });
  const overlay = map.querySelector(":scope > .relation-layer");
  if (overlay) {
    const defs = add(svg, "defs", {});
    const marker = add(defs, "marker", {
      id: "export-relation-arrow",
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto",
    });
    add(marker, "path", { d: "M0 0L10 5L0 10z", fill: relationColor });
    const group = add(svg, "g", {
      transform: `translate(${(mapRect.left - left) / zoom + MARGIN} ${(mapRect.top - top) / zoom + MARGIN})`,
    });
    overlay.querySelectorAll(".relation-line").forEach((path) =>
      add(group, "path", {
        d: path.getAttribute("d"),
        fill: "none",
        stroke: relationColor,
        "stroke-width": 1.5,
        "stroke-dasharray": "5 4",
        "marker-end": "url(#export-relation-arrow)",
      }),
    );
    overlay.querySelectorAll(".relation-label").forEach((label) =>
      add(
        group,
        "text",
        {
          x: label.getAttribute("x"),
          y: label.getAttribute("y"),
          "text-anchor": "middle",
          fill: relationColor,
          "font-size": 12,
        },
        label.textContent,
      ),
    );
  }
  return {
    svg: new XMLSerializer()
      .serializeToString(svg)
      .replace(
        /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,
        "\uFFFD",
      ),
    width,
    height,
  };
}

export async function pngBase64(
  svg: string,
  width: number,
  height: number,
): Promise<string> {
  const image = new Image();
  const data = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the SVG image"));
    reader.readAsDataURL(data);
  });
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not render the SVG image"));
    image.src = src;
  });
  const scale = Math.min(
    2,
    16000 / width,
    16000 / height,
    Math.sqrt(32000000 / (width * height)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the image canvas");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").split(",", 2)[1];
}
