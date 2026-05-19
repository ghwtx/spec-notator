import type { EnrichedAnnotation, AgentVariant, DocPayload } from "../types";

const esc = (s: string | undefined): string =>
  (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Build location attributes: line/line_end for ranges, col_start/col_end for
// partial single-block selections. Falls back to line="?" when missing.
function locAttrs(a: { line: number; lineEnd?: number; blockIds?: string[]; start: number; end: number }): string {
  const line = a.line || 0;
  const lineEnd = a.lineEnd ?? line;
  const isPinpoint = !!(a.blockIds && a.blockIds.length > 1);
  const parts: string[] = [`line="${line || "?"}"`];
  if (lineEnd > line) parts.push(`line_end="${lineEnd}"`);
  if (!isPinpoint && line === lineEnd && (a.start > 0 || a.end > 0)) {
    parts.push(`col_start="${a.start + 1}"`, `col_end="${a.end + 1}"`);
  }
  return parts.join(" ");
}

export function buildXML(
  doc: DocPayload,
  annotations: EnrichedAnnotation[],
  opts: { variant?: AgentVariant } = {},
): string {
  const list = annotations;
  const variant = opts.variant || "structured";

  if (variant === "patch") {
    const parts: string[] = [
      `<review file="${esc(doc.name)}" generated="${new Date().toISOString()}">`,
    ];
    parts.push(
      `  <summary>Apply the following ${list.length} change${list.length === 1 ? "" : "s"} to the document. Preserve all other content.</summary>`,
    );
    list.forEach((a, i) => {
      const scope = a.blockIds && a.blockIds.length > 1 ? ` scope="${a.blockIds.length}-blocks"` : "";
      const lines = [
        `  <change id="${i + 1}" type="${a.type}" ${locAttrs(a)} section="${esc(a.blockCrumb || "")}"${scope}>`,
      ];
      if (a.quoted) lines.push(`    <target>${esc(a.quoted)}</target>`);
      if (a.replacement) lines.push(`    <replacement>${esc(a.replacement)}</replacement>`);
      if (a.note) lines.push(`    <reason>${esc(a.note)}</reason>`);
      lines.push(`  </change>`);
      parts.push(lines.join("\n"));
    });
    parts.push(`</review>`);
    return parts.join("\n");
  }

  if (variant === "task") {
    const parts: string[] = [
      `<task>`,
      `  <context>`,
      `    You are editing the markdown document \`${esc(doc.name)}\`. The author has left`,
      `    ${list.length} review note${list.length === 1 ? "" : "s"}. Apply each one faithfully.`,
      `  </context>`,
      `  <instructions>`,
    ];
    list.forEach((a, i) => {
      const verb =
        a.type === "replace" ? "Replace" :
        a.type === "delete" ? "Remove" :
        a.type === "add" ? "Insert near" :
        a.type === "question" ? "Research and answer the question raised about" :
        a.type === "approve" ? "(Approved — no change needed)" :
        "Address this comment about";
      parts.push(`    <step n="${i + 1}" type="${a.type}">`);
      parts.push(`      <action>${verb}</action>`);
      if (a.blockCrumb) parts.push(`      <where section="${esc(a.blockCrumb)}" ${locAttrs(a)}/>`);
      if (a.quoted) parts.push(`      <quote>${esc(a.quoted)}</quote>`);
      if (a.replacement) parts.push(`      <with>${esc(a.replacement)}</with>`);
      if (a.note) parts.push(`      <note>${esc(a.note)}</note>`);
      parts.push(`    </step>`);
    });
    parts.push(`  </instructions>`);
    parts.push(`</task>`);
    return parts.join("\n");
  }

  const parts: string[] = [
    `<review_session>`,
    `  <document name="${esc(doc.name)}" total_annotations="${list.length}"/>`,
    `  <annotations>`,
  ];
  list.forEach((a, i) => {
    const scope = a.blockIds && a.blockIds.length > 1 ? ` scope="${a.blockIds.length}-blocks"` : "";
    parts.push(`    <annotation id="${i + 1}" type="${a.type}" ${locAttrs(a)}${scope}>`);
    if (a.blockCrumb) parts.push(`      <location section="${esc(a.blockCrumb)}"/>`);
    if (a.quoted) parts.push(`      <quoted_text>${esc(a.quoted)}</quoted_text>`);
    if (a.note) parts.push(`      <reviewer_note>${esc(a.note)}</reviewer_note>`);
    if (a.replacement) {
      const tag = a.type === "add" ? "proposed_addition" : "proposed_text";
      parts.push(`      <${tag}>${esc(a.replacement)}</${tag}>`);
    }
    parts.push(`    </annotation>`);
  });
  parts.push(`  </annotations>`);
  parts.push(`  <instructions>`);
  parts.push(`    Apply each annotation to the source document. For 'replace' and 'add'`);
  parts.push(`    annotations use the proposed text verbatim. For 'delete' annotations remove`);
  parts.push(`    the quoted span (and its enclosing sentence if removal would leave a fragment).`);
  parts.push(`    For 'question' annotations, research the question against the document's`);
  parts.push(`    surrounding context (and any other authoritative sources you have access to),`);
  parts.push(`    then add a substantive answer inline in the document — not just a flag or`);
  parts.push(`    placeholder. If you cannot answer confidently, say so explicitly and explain`);
  parts.push(`    what additional information would be needed.`);
  parts.push(`    For 'approve' annotations make no change. Preserve markdown formatting throughout.`);
  parts.push(`  </instructions>`);
  parts.push(`</review_session>`);
  return parts.join("\n");
}

export function syntaxHighlightXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(&lt;\/?)([a-z_][\w]*)([^&]*?)(\/?&gt;)/gi, (_, lt, tag, rest, gt) => {
      const attrs = rest.replace(
        /([a-z_][\w-]*)(=)("[^"]*")/gi,
        '<span class="xml-attr">$1</span>=<span class="xml-str">$3</span>',
      );
      return `<span class="xml-tag">${lt}${tag}</span>${attrs}<span class="xml-tag">${gt}</span>`;
    });
}
