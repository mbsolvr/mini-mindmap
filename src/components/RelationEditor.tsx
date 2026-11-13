import { fitContextMenu } from "../contextMenu.ts";
import type { Dispatch, SetStateAction } from "react";
import type { RelationContext } from "../hooks/useRelations.ts";
import { MenuLabel } from "./AppMenu.tsx";

interface Props {
  context: RelationContext | null;
  setContext: Dispatch<SetStateAction<RelationContext | null>>;
  findIndex: (key: string, tab: number, viewKey: object) => number;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}
export default function RelationEditor({
  context,
  setContext,
  findIndex,
  onEdit,
  onDelete,
}: Props) {
  return (
    <>
      {context && (
        <div
          ref={(menu) => fitContextMenu(menu)}
          className="context relation-context"
          style={{ left: context.x, top: context.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-actions">
            <button
              onClick={() =>
                onEdit(findIndex(context.key, context.tab, context.viewKey))
              }
            >
              <MenuLabel label="Rename" />
            </button>
            <button
              onClick={() => {
                const index = findIndex(
                  context.key,
                  context.tab,
                  context.viewKey,
                );
                if (index >= 0) onDelete(index);
                setContext(null);
              }}
            >
              <MenuLabel label="Delete" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
