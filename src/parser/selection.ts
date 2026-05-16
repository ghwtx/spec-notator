export interface SelectionInfo {
  blockId: string;
  start: number;
  end: number;
  quoted: string;
  rect: { left: number; right: number; top: number; bottom: number; width: number; height: number };
}

function textOffsetWithin(root: Element, node: Node, offset: number): number {
  if (!root || !node) return 0;
  if (!root.contains(node) && root !== node) return 0;
  try {
    const r = document.createRange();
    r.selectNodeContents(root);
    r.setEnd(node, offset);
    return r.toString().length;
  } catch (e) {
    return 0;
  }
}

export function getSelectionInfo(): SelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  let n: Node | null = range.commonAncestorContainer;
  if (n && n.nodeType === 3) n = n.parentNode;
  if (!n || !(n as Element).closest) return null;
  const blockEl = (n as Element).closest("[data-block-id]") as HTMLElement | null;
  if (!blockEl) return null;
  const blockId = blockEl.dataset.blockId!;
  const startOff = textOffsetWithin(blockEl, range.startContainer, range.startOffset);
  const endOff = textOffsetWithin(blockEl, range.endContainer, range.endOffset);
  if (startOff === endOff) return null;
  const quoted = sel.toString();
  if (!quoted.trim()) return null;
  const rect = range.getBoundingClientRect();
  return {
    blockId,
    start: Math.min(startOff, endOff),
    end: Math.max(startOff, endOff),
    quoted,
    rect: {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    },
  };
}

export function wrapTextRange(
  root: Element,
  start: number,
  end: number,
  attrs: Record<string, string>,
): void {
  if (!root || end <= start) return;
  const segs: { node: Text; sStart: number; sEnd: number }[] = [];
  let pos = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n: Node) {
      if (
        (n as Text).parentElement &&
        (n as Text).parentElement!.closest(".annot-mark-skip")
      )
        return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    const len = tn.nodeValue!.length;
    const sStart = Math.max(0, start - pos);
    const sEnd = Math.min(len, end - pos);
    if (sStart < sEnd) segs.push({ node: tn, sStart, sEnd });
    pos += len;
    if (pos >= end) break;
  }
  for (let k = segs.length - 1; k >= 0; k--) {
    const { node, sStart, sEnd } = segs[k];
    let target: Text = node;
    if (sStart > 0) target = target.splitText(sStart);
    if (sEnd - sStart < target.nodeValue!.length) target.splitText(sEnd - sStart);
    const wrap = document.createElement("span");
    for (const [k2, v] of Object.entries(attrs)) wrap.setAttribute(k2, v);
    target.parentNode!.insertBefore(wrap, target);
    wrap.appendChild(target);
  }
}

export function clearMarks(root: Element): void {
  if (!root) return;
  root.querySelectorAll(".annot-mark").forEach((m) => {
    const parent = m.parentNode!;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}
