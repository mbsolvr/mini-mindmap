import type { MapContent, TextStyle } from "../types.ts";
import { findNode, treeForKey } from "../model.ts";
import NodeContextMenu from "./NodeContextMenu.tsx";

import type { TopicMenuContext } from "../hooks/useContextMenus.ts";
interface Props {
  map: MapContent;
  topic: TopicMenuContext | null;
  note: TopicMenuContext | null;
  onTopicStyle: (patch: Partial<TextStyle>) => void;
  onTopicRelation: (key: string) => void;
  multipleTopics: boolean;
  onTopicSummary: () => void;
  canAddSummary: boolean;
  onTopicRemove: (key: string) => void;
  onNoteStyle: (key: string, patch: Partial<TextStyle>) => void;
  onNoteRemove: (key: string) => void;
}
export default function TopicContextMenus({
  map,
  topic,
  note,
  onTopicStyle,
  onTopicRelation,
  multipleTopics,
  onTopicSummary,
  canAddSummary,
  onTopicRemove,
  onNoteStyle,
  onNoteRemove,
}: Props) {
  const node = topic
    ? findNode(treeForKey(map, topic.key) || map.tree, topic.key)
    : null;
  const floatingNote = note
    ? map.floatingNotes?.find((item) => item.key === note.key)
    : null;
  return (
    <>
      {topic && node && (
        <NodeContextMenu
          {...topic}
          node={node}
          isRoot={topic.key === map.tree.key}
          multiple={multipleTopics}
          onStyle={onTopicStyle}
          onRelation={() => onTopicRelation(topic.key)}
          onSummary={onTopicSummary}
          canAddSummary={canAddSummary}
          onRemove={() => onTopicRemove(topic.key)}
        />
      )}
      {note && floatingNote && (
        <NodeContextMenu
          {...note}
          node={{
            key: floatingNote.key,
            text: floatingNote.text,
            children: [],
            textStyle: floatingNote.textStyle,
          }}
          isRoot={false}
          onStyle={(patch) => onNoteStyle(floatingNote.key, patch)}
          onRemove={() => onNoteRemove(floatingNote.key)}
        />
      )}
    </>
  );
}
