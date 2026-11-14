export interface Point {
  x: number;
  y: number;
}

export interface RelationControls {
  // Map-space offsets from the source and target topic centers, respectively.
  start: Point;
  end: Point;
}

export interface Relation {
  relKey: string;
  from: string;
  to: string;
  label: string;
  controls?: RelationControls;
}

export interface Summary {
  key: string;
  topics: string[];
}

export interface TextStyle {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  size?: number;
}

export interface MindNode {
  key: string;
  text: string;
  tabTitle?: string;
  notes?: string;
  labels?: string[];
  children: MindNode[];
  collapsed?: boolean;
  side?: "left" | "right";
  layout?: string;
  template?: string;
  relations?: Relation[];
  summaries?: Summary[];
  image?: { src: string; caption?: string };
  link?: { url: string; label?: string };
  textStyle?: TextStyle;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface FloatingTopic {
  tree: MindNode;
  x: number;
  y: number;
}
export interface FloatingNote {
  key: string;
  text: string;
  x: number;
  y: number;
  textStyle?: TextStyle;
}
export interface MapContent {
  tree: MindNode;
  floatingTopics?: FloatingTopic[];
  floatingNotes?: FloatingNote[];
}
export interface MapDocument extends MapContent {
  format: "mini-mindmap";
  version: 2;
  type: "map";
}
export interface Workspace {
  format: "mini-mindmap";
  version: 2;
  type: "workspace";
  active: number;
  tabs: MapContent[];
}
export type Document = MapDocument | Workspace;
