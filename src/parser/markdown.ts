import type { MdBlock } from "../types";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function mdInline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );
  return s;
}

export function parseMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let id = 0;
  const nextId = () => `b${id++}`;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ id: nextId(), kind: "code", lang, text: buf.join("\n"), line: 0 });
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const slug = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");
      blocks.push({ id: nextId(), kind: "heading", level, text, slug, line: 0 });
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      blocks.push({ id: nextId(), kind: "hr", line: 0 });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ id: nextId(), kind: "blockquote", text: buf.join(" "), line: 0 });
      continue;
    }

    if (
      /\|/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?[-:\s|]+\|?\s*$/.test(lines[i + 1]) &&
      /\|/.test(lines[i + 1])
    ) {
      const splitRow = (r: string) =>
        r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ id: nextId(), kind: "table", header, rows, line: 0 });
      continue;
    }

    const ul = line.match(/^(\s*)([-*+])\s+(.*)$/);
    const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ul || ol) {
      const ordered = !!ol;
      const items: { text: string }[] = [];
      while (i < lines.length) {
        const m1 = lines[i].match(/^(\s*)([-*+])\s+(.*)$/);
        const m2 = lines[i].match(/^(\s*)(\d+)\.\s+(.*)$/);
        const m = ordered ? m2 : m1;
        if (!m) {
          if (items.length && /^\s+\S/.test(lines[i]) && lines[i].trim()) {
            items[items.length - 1].text += " " + lines[i].trim();
            i++;
            continue;
          }
          if (/^\s*$/.test(lines[i])) {
            i++;
            if (i < lines.length && /^(\s*[-*+]|\s*\d+\.)\s+/.test(lines[i])) continue;
            else break;
          }
          break;
        }
        items.push({ text: m[3] });
        i++;
      }
      blocks.push({ id: nextId(), kind: "list", ordered, items, line: 0 });
      continue;
    }

    const buf: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^(\s*[-*+]|\s*\d+\.)\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ id: nextId(), kind: "paragraph", text: buf.join(" ").trim(), line: 0 });
  }

  // assign line numbers (best-effort: forward-scan for first content match)
  const mdLines = md.split("\n");
  let cursor = 1;
  let cursorIdx = 0;
  for (const b of blocks) {
    const probe =
      b.kind === "heading" ? b.text :
      b.kind === "paragraph" ? (b.text.split(" ")[0] || "") :
      b.kind === "code" ? "```" :
      b.kind === "list" ? (b.items[0]?.text?.split(" ")[0] || "") :
      b.kind === "table" ? (b.header[0] || "") :
      "";
    if (!probe) {
      b.line = cursor;
      continue;
    }
    for (let k = cursorIdx; k < mdLines.length; k++) {
      if (mdLines[k].includes(probe)) {
        b.line = k + 1;
        cursorIdx = k + 1;
        break;
      }
    }
    if (!b.line) b.line = cursor;
    cursor = b.line + 1;
  }

  return blocks;
}
