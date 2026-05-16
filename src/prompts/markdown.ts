import type { EnrichedAnnotation, AgentVariant, DocPayload } from "../types";
import { TYPES, TYPE_BY_ID } from "../types";

export function buildMarkdown(
  doc: DocPayload,
  annotations: EnrichedAnnotation[],
  opts: { variant?: AgentVariant } = {},
): string {
  const list = annotations.filter((a) => !a.resolved);
  const variant = opts.variant || "structured";

  if (list.length === 0) {
    return `# Review of ${doc.name}\n\n_(no open annotations)_`;
  }

  if (variant === "patch") {
    const parts: string[] = [
      `# Review of ${doc.name}`,
      ``,
      `Apply the following ${list.length} change${list.length === 1 ? "" : "s"} to the document. Preserve all other content.`,
      ``,
      `## Changes`,
      ``,
    ];
    list.forEach((a, i) => {
      const t = TYPE_BY_ID[a.type];
      const scope = a.blockIds && a.blockIds.length > 1 ? ` (spans ${a.blockIds.length} blocks)` : "";
      parts.push(`### Change ${i + 1} — ${t.label} at line ${a.line || "?"}${scope}`);
      if (a.blockCrumb) parts.push(`**Section:** ${a.blockCrumb}`);
      if (a.quoted) parts.push(`**Quoted:**\n> ${a.quoted.replace(/\n/g, "\n> ")}`);
      const action =
        a.type === "replace" ? "Replace the quoted text" :
        a.type === "delete" ? "Remove the quoted text" :
        a.type === "add" ? "Insert new content near the quoted location" :
        a.type === "question" ? "Research and answer the reviewer's question, adding the answer inline in the document" :
        a.type === "approve" ? "(Approved — no change needed)" :
        "Address this comment";
      parts.push(`**Action:** ${action}`);
      if (a.replacement) parts.push(`**Replacement:**\n\n\`\`\`\n${a.replacement}\n\`\`\``);
      if (a.note) parts.push(`**Reason:** ${a.note}`);
      parts.push(``);
    });
    return parts.join("\n");
  }

  if (variant === "task") {
    const parts: string[] = [
      `# Review tasks for ${doc.name}`,
      ``,
      `You are editing the markdown document \`${doc.name}\`. The author has left ${list.length} review note${list.length === 1 ? "" : "s"}. Apply each step faithfully and preserve all other content.`,
      ``,
      `## Steps`,
      ``,
    ];
    list.forEach((a, i) => {
      const where = a.blockCrumb ? ` in the "${a.blockCrumb}" section (line ${a.line || "?"})` : ` at line ${a.line || "?"}`;
      let step: string;
      if (a.type === "replace") {
        step = `Replace ${a.quoted ? `"${a.quoted}"` : "the highlighted text"}${where}${a.replacement ? ` with: \`${a.replacement}\`` : ""}.`;
      } else if (a.type === "delete") {
        step = `Remove ${a.quoted ? `"${a.quoted}"` : "the highlighted text"}${where}.`;
      } else if (a.type === "add") {
        step = `Insert${a.replacement ? ` \`${a.replacement}\`` : " new content"}${where}${a.quoted ? `, near "${a.quoted}"` : ""}.`;
      } else if (a.type === "question") {
        step = `Research and answer this question${where}${a.quoted ? ` (about "${a.quoted}")` : ""}: ${a.note || "(see context)"}. Add the answer inline in the document; if you can't answer confidently, say so explicitly and explain what's missing.`;
      } else if (a.type === "approve") {
        step = `(Approved — no change needed${where}.)`;
      } else {
        step = `Address this comment${where}${a.quoted ? ` about "${a.quoted}"` : ""}: ${a.note || "(see context)"}.`;
      }
      if (a.note && a.type !== "question" && a.type !== "comment") {
        step += ` Reason: ${a.note}.`;
      }
      parts.push(`${i + 1}. ${step}`);
    });
    return parts.join("\n");
  }

  // structured (default)
  const parts: string[] = [
    `# Review of ${doc.name}`,
    ``,
    `Total open annotations: **${list.length}**`,
    ``,
  ];
  const groups: Record<string, EnrichedAnnotation[]> = {};
  list.forEach((a) => {
    (groups[a.type] = groups[a.type] || []).push(a);
  });
  TYPES.forEach((t) => {
    const g = groups[t.id];
    if (!g || g.length === 0) return;
    parts.push(`## ${t.label}${g.length > 1 ? "s" : ""} (${g.length})`);
    parts.push(``);
    g.forEach((a) => {
      const loc = `${a.blockCrumb || "—"} · L${a.line || "?"}`;
      parts.push(`- **${loc}**`);
      if (a.quoted) parts.push(`  > ${a.quoted.replace(/\n/g, "\n  > ")}`);
      if (a.note) parts.push(`  - Note: ${a.note}`);
      if (a.replacement) {
        const label = a.type === "add" ? "Insert" : "Rewrite as";
        parts.push(`  - ${label}:\n\n    \`\`\`\n    ${a.replacement.replace(/\n/g, "\n    ")}\n    \`\`\``);
      }
      parts.push(``);
    });
  });
  parts.push(`## Instructions`);
  parts.push(``);
  parts.push(
    `Apply each open annotation to the source document. For "Replace" and "Add" annotations use the proposed text verbatim. For "Delete" annotations remove the quoted span (and its enclosing sentence if removal would leave a fragment). For "Question" annotations, research the question against the document's surrounding context (and any other authoritative sources you have access to), then add a substantive answer inline in the document — not just a flag or placeholder. If you cannot answer confidently, say so explicitly and explain what additional information would be needed. For "Approve" annotations make no change. Preserve markdown formatting throughout.`,
  );
  return parts.join("\n");
}

export function syntaxHighlightMarkdown(s: string): string {
  // Light markdown-aware tinting for the modal preview.
  const esc = (str: string) =>
    str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc(s)
    .replace(/^(#{1,6}\s.*)$/gm, '<span class="md-heading">$1</span>')
    .replace(/^(&gt;\s.*)$/gm, '<span class="md-quote">$1</span>')
    .replace(/^(\s*[-*+]\s.*)$/gm, '<span class="md-list">$1</span>')
    .replace(/^(\s*\d+\.\s.*)$/gm, '<span class="md-list">$1</span>')
    .replace(/(`[^`\n]+`)/g, '<span class="md-code">$1</span>')
    .replace(/(\*\*[^*\n]+\*\*)/g, '<span class="md-bold">$1</span>');
}
