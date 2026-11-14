# File formats and XMind exchange

Use **File → Import XMind…** to append every sheet in an `.xmind` workbook as a tab. Import is one undoable operation and does not change the current `.minimap` save destination. Cancellation and failed validation leave the workspace unchanged. Imported tabs remain unsaved until the usual save or auto-save operation.

Use **File → Export XMind…** to export all tabs, including the active tab selection, as a modern JSON-based XMind workbook. Export does not change the save destination or mark the native document saved. The backend uses the same atomic replacement and current-file overwrite protection as other exports.

## Native `.minimap` container

The existing split format remains the native format. A single map and a multi-tab workspace use the same map representation:

```text
manifest.json          format, archive version, document type, active tab, ordered map paths
maps/1.json            tree, optional floatingTopics and floatingNotes
maps/2.json            another tab, when present
assets/1.png           shared binary image
assets/2.jpg
```

Maps contain image paths rather than base64 image data. Identical images share one asset across the entire workspace. Each topic owns its children and optional content/style fields; relations and summary membership are stored once on the map root using topic IDs. Floating topics and notes have map-space coordinates. Topic `notes` (plain text) and `labels` (a string array) retain imported XMind information, although the editor does not currently display or edit these fields.

The manifest uses archive version 2, or version 4 when summaries are present; the in-memory document version remains 2. Native entries use STORE compression, which keeps the existing native size validation and avoids repeatedly recompressing documents during auto-save. XMind support does not require a second native schema or a migration.

## Exported `.xmind` container

```text
content.json           ordered array of sheets and their topics
metadata.json          creator, XMind structure version, activeSheetId
manifest.json          file-entries index
resources/1.png        shared binary image, referenced as xap:resources/1.png
resources/2.jpg
```

JSON entries use DEFLATE level 6. Images already have their own compression and use STORE. Shared images are written once across all sheets. No second copy of the native workspace, embedded base64 image strings, placeholder thumbnail, or obsolete XML document is included.

Standard XMind fields carry titles, attached/detached topics, folding, supported layouts, HTTP(S) links, plain notes, labels, images, explicit text styles, relationships and representable summary ranges. Unbalanced mind maps group right-side branches before left-side branches and record XMind's `right-number` extension. The original native child order is retained separately.

A small `mini-mindmap` field holds information without an exact XMind equivalent:

- Sheet: extension version 1 and native summary membership.
- Topic: native layout/theme/side/folding metadata, child order when needed, image caption and link label. Floating notes are standard detached topics marked with `kind: "note"`.
- Relationship: native curve control offsets.

This preserves supported Mini Mindmap data when exported and directly imported again without duplicating topic trees or image data. Other applications may discard these extension fields when resaving. In XMind, floating notes appear as floating topics; custom curves use default XMind control points. A summary spanning different parents or trees retains its title and extension data, but cannot be expressed as XMind's contiguous sibling range. Export reports these summary/curve differences.

## Import and validation

Modern `content.json` is preferred. XMind 8 `content.xml` (including the historical `/content.xml` entry), optional `styles.xml`, and image resources in `resources/` or `attachments/` are also read. XML is normalized to the same intermediate sheet/topic structure; XML export is unnecessary for modern XMind.

The shared ZIP directory validator runs before JSZip. XMind permits STORE and DEFLATE; native files retain their stricter entry whitelist and STORE requirement. Imports reject encrypted/multipart archives, duplicate paths, traversal paths, conflicting Unicode names and inconsistent local/central headers. ZIP64 is not supported. XMind reads only referenced entries, checks actual output sizes and CRC32 while inflating, caches shared resources, and enforces the expanded image-reference budget before creating the workspace. XML DTDs and entity declarations are rejected.

Both formats limit archives and total declared expanded entries to 256 MiB and 10,000 entries, individual images to 10 MiB, and each map to 5,000 objects and 100 levels. XMind additionally bounds inflated data and the expanded document/image representation to prevent compressed inputs or many references to one image from bypassing limits. Invalid connections and conflicting summary data are rejected by the existing document validator.

XMind themes, shapes, markers, boundaries, callouts, unsupported layouts, non-HTTP links and unsupported image formats are not fully represented by the current editor. Import reports detected limitations rather than implying visual fidelity. Rich-text notes are reduced to plain text. Native themes and viewport state are not portable XMind styles. These exchanges are covered by JSON/XML fixtures and browser tests; visual comparison in the proprietary XMind application is still a separate manual check.

## References

The conversion follows XMind's published [topic model](https://github.com/xmindltd/xmind-model/blob/master/schemas/topic.json), [summary schema](https://github.com/xmindltd/xmind-model/blob/master/schemas/summary.json), [relationship schema](https://github.com/xmindltd/xmind-model/blob/master/schemas/relationship.json), and [embedded image model](https://github.com/xmindltd/xmind-model/blob/master/src/models/topic-image.ts). Bounded inflation uses JSZip's documented [entry streaming API](https://stuk.github.io/jszip/documentation/api_zipobject/internal_stream.html).
