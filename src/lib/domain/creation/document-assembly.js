import { createHash } from "node:crypto";
import { textDocumentSchema } from "../../creation/contracts/document.js";
import { documentOutlineSchema } from "../../creation/contracts/document-language.js";
import { AppError } from "../../http.js";

export function assembleDocumentContent(input, sections, locale = "zh") {
  const outline = documentOutlineSchema.parse(input);
  if (sections.length !== outline.sections.length) throw new AppError("CREATION_OUTLINE_CHANGED", 409);
  // Different model calls often reuse "paragraph1". Namespace generated IDs
  // deterministically once at publication, not on every subsequent save/edit.
  const content = sections.map((section, index) => {
    const approved = outline.sections[index];
    if (section.id !== approved.id || section.title !== approved.title) throw new AppError("CREATION_OUTLINE_CHANGED", 409);
    const idFor = id => `d_${createHash("sha256").update(JSON.stringify([section.id, id])).digest("hex")}`;
    return { ...section, blocks: section.blocks.map(block => ({ ...block, id: idFor(block.id),
      ...(block.type === "list" ? { items: block.items.map(item => ({ ...item, id: idFor(item.id) })) } : {}),
      ...(block.type === "table" ? { rows: block.rows.map(row => ({ ...row, id: idFor(row.id), cells: row.cells.map(cell => ({ ...cell, id: idFor(cell.id) })) })) } : {}),
    })) };
  });
  const parsed = textDocumentSchema.safeParse({ schemaVersion: 1, kind: "document", title: outline.title, locale, sections: content,
    ...(outline.design ? { page: outline.design.page, theme: outline.design.theme } : {}),
  });
  if (!parsed.success) throw new AppError(parsed.error.issues.some(issue => issue.message === "DOCUMENT_CONTENT_LIMIT") ? "DOCUMENT_CONTENT_LIMIT" : "INVALID_DOCUMENT_RESULT", 422);
  return parsed.data;
}
