// XMind 8 XML is normalized to the same sheet/topic shape as modern content.json.
import { validateTabCount, validateRelationCount } from "./limits.ts";
import { checkParseBudget } from "./parseBudget.ts";

export function readXmindXml(text: string, styleText?: string, budget = { count: 0 }): unknown[] {
  const invalid = () => { throw new Error("Invalid or unsupported XMind file"); };
  checkParseBudget(text, true, budget);
  if (styleText) checkParseBudget(styleText, true, budget);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) invalid();
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "xmap-content") invalid();
  const elements = (parent: Element, name: string) => Array.from(parent.children).filter(child => child.localName === name);
  const element = (parent: Element, name: string) => elements(parent, name)[0];
  const content = (parent: Element, name: string) => element(parent, name)?.textContent ?? "";
  const styles = new Map<string, Record<string, string>>();
  if (styleText && /<!DOCTYPE|<!ENTITY/i.test(styleText)) invalid();
  const styleDocument = styleText ? new DOMParser().parseFromString(styleText, "application/xml") : document;
  if (styleDocument.querySelector("parsererror")) invalid();
  for (const style of Array.from(styleDocument.getElementsByTagNameNS("*", "style"))) {
    const props = element(style, "topic-properties");
    if (props) styles.set(style.getAttribute("id") || "", Object.fromEntries(Array.from(props.attributes).map(attr => [attr.name, attr.value])));
  }
  let count = 0;
  function topic(node: Element, depth: number, nesting = 0): Record<string, unknown> {
    if (nesting > 512) throw new Error("Document exceeds the 100000 structure or 512 nesting limit");
    if (++count > 5000 || depth > 100) throw new Error("A map can contain at most 5000 objects and 100 levels");
    const result: Record<string, unknown> = { id: node.getAttribute("id"), title: content(node, "title") };
    for (const [xml, json] of [["structure-class", "structureClass"], ["branch", "branch"], ["xlink:href", "href"]])
      if (node.hasAttribute(xml)) result[json] = node.getAttribute(xml);
    const position = element(node, "position");
    if (position) result.position = { x: Number(position.getAttribute("svg:x") ?? position.getAttribute("x")), y: Number(position.getAttribute("svg:y") ?? position.getAttribute("y")) };
    const image = element(node, "img") || element(node, "image");
    if (image) result.image = { src: image.getAttribute("xhtml:src") ?? image.getAttribute("src") };
    const style = styles.get(node.getAttribute("style-id") || "");
    if (style) result.style = { properties: style };
    const notes = element(node, "notes");
    if (notes) result.notes = { plain: { content: element(notes, "plain")?.textContent ?? notes.textContent ?? "" } };
    const labels = element(node, "labels");
    if (labels) result.labels = elements(labels, "label").map(label => label.textContent || "");
    const children = element(node, "children");
    if (children) result.children = Object.fromEntries(elements(children, "topics").map(group => [group.getAttribute("type") || "attached", elements(group, "topic").map(child => topic(child, group.getAttribute("type") === "detached" ? 0 : depth + 1, nesting + 1))]));
    const summaries = element(node, "summaries");
    if (summaries) result.summaries = elements(summaries, "summary").map(summary => ({ id: summary.getAttribute("id"), topicId: summary.getAttribute("topic-id"), range: summary.getAttribute("range") }));
    for (const name of ["boundaries", "markers"])
      if (element(node, name)?.children.length) result[name] = [{}];
    if (element(node, "marker-refs")?.children.length) result.markers = [{}];
    return result;
  }
  const sheets = elements(document.documentElement, "sheet");
  validateTabCount(sheets.length);
  return sheets.map(sheet => {
    count = 0;
    const root = element(sheet, "topic");
    if (!root) return invalid();
    const relationships = element(sheet, "relationships");
    const relations = relationships ? elements(relationships, "relationship") : [];
    validateRelationCount(relations.length);
    return { id: sheet.getAttribute("id"), title: content(sheet, "title"), rootTopic: topic(root, 0),
      relationships: relations.map(relation => ({ id: relation.getAttribute("id"), end1Id: relation.getAttribute("end1"), end2Id: relation.getAttribute("end2"), title: content(relation, "title"), ...(element(relation, "control-points") ? { controlPoints: {} } : {}) })) };
  });
}
