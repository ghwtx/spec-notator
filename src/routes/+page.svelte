<script lang="ts">
  import { onMount, tick } from "svelte";
  import "../styles/global.css";
  import { parseMarkdown, mdInline } from "../parser/markdown";
  import {
    getSelectionInfo,
    wrapTextRange,
    clearMarks,
    type SelectionInfo,
  } from "../parser/selection";
  import { buildXML, syntaxHighlightXml } from "../prompts/xml";
  import { buildSlack } from "../prompts/slack";
  import { buildMarkdown, syntaxHighlightMarkdown } from "../prompts/markdown";
  import { SAMPLE_DOC } from "../lib/sample-doc";
  import {
    TYPES,
    TYPE_BY_ID,
    type Annotation,
    type AnnotationType,
    type EnrichedAnnotation,
    type DocPayload,
    type MdBlock,
    type BlockMeta,
    type AgentFormat,
    type AgentVariant,
    type SlackTone,
    type SlackGrouping,
  } from "../types";
  import {
    Search,
    FileSearch,
    Sun,
    Moon,
    Send,
    MousePointer2,
    Crosshair,
    Plus,
    Check,
    Trash2,
    X,
    MessageSquare,
    Replace as ReplaceIcon,
    HelpCircle,
    ThumbsUp,
    Copy as CopyIcon,
    Settings as SettingsIcon,
    Keyboard,
  } from "@lucide/svelte";

  // Map annotation type → Lucide icon component
  const TYPE_ICON = {
    comment: MessageSquare,
    replace: ReplaceIcon,
    delete: X,
    add: Plus,
    question: HelpCircle,
    approve: ThumbsUp,
  } as const;

  // ───── Persisted-state helpers ────────────────────────────────────────
  function lsGet(k: string, fb: string): string {
    if (typeof localStorage === "undefined") return fb;
    return localStorage.getItem(k) ?? fb;
  }
  function lsSet(k: string, v: string) {
    if (typeof localStorage !== "undefined") localStorage.setItem(k, v);
  }

  // ───── App state ──────────────────────────────────────────────────────
  let theme = $state<"dark" | "light">("dark");
  let doc = $state<DocPayload>(SAMPLE_DOC);
  let annotations = $state<Annotation[]>([]);
  let activeId = $state<string | null>(null);
  let filter = $state<string>("all");
  let outputOpen = $state(false);
  let settingsOpen = $state(false);
  let paletteOpen = $state(false);
  let cheatOpen = $state(false);
  let search = $state("");
  let searchIdx = $state(0);
  let selectionInfo = $state<SelectionInfo | null>(null);
  let activeSlug = $state<string | null>(null);
  let tocW = $state(240);
  let annW = $state(340);
  let dropping = $state(false);
  let toolbarStyle = $state<"floating" | "inline" | "margin">("floating");
  let agentFormat = $state<AgentFormat>("xml");
  let agentVariant = $state<AgentVariant>("structured");
  let slackTone = $state<SlackTone>("casual");
  let slackGrouping = $state<SlackGrouping>("order");
  let slackIncludeQuotes = $state(true);
  let copied = $state(false);
  let focusContext = $state<"toc" | "doc" | "annotations">("doc");
  let focusedBlockId = $state<string | null>(null);
  let focusedHeadingSlug = $state<string | null>(null);
  let focusedAnnotationId = $state<string | null>(null);

  // Pinpoint mode: select whole blocks, optionally many, then apply an annotation type
  let pinpointMode = $state(false);
  let pinpointSelected = $state<string[]>([]);
  let pinpointAnchorId = $state<string | null>(null); // for shift-click range
  function togglePinpoint() {
    pinpointMode = !pinpointMode;
    if (!pinpointMode) { pinpointSelected = []; pinpointAnchorId = null; }
  }

  // ───── Hydrate persisted values on mount ──────────────────────────────
  onMount(() => {
    theme = (lsGet("sn-theme", "dark") as "dark" | "light");
    tocW = parseInt(lsGet("sn-tocw", "240"), 10);
    annW = parseInt(lsGet("sn-annw", "340"), 10);
    toolbarStyle = lsGet("sn-toolbar", "floating") as "floating" | "inline" | "margin";
    agentFormat = lsGet("sn-fmt", "xml") as AgentFormat;
    agentVariant = lsGet("sn-variant", "structured") as AgentVariant;
    slackTone = lsGet("sn-slack-tone", "casual") as SlackTone;
    slackGrouping = lsGet("sn-slack-group", "order") as SlackGrouping;
    document.documentElement.dataset.theme = theme;
  });

  $effect(() => {
    if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
    lsSet("sn-theme", theme);
  });
  $effect(() => { lsSet("sn-tocw", String(tocW)); });
  $effect(() => { lsSet("sn-annw", String(annW)); });
  $effect(() => { lsSet("sn-toolbar", toolbarStyle); });
  $effect(() => { lsSet("sn-fmt", agentFormat); });
  $effect(() => { lsSet("sn-variant", agentVariant); });
  $effect(() => { lsSet("sn-slack-tone", slackTone); });
  $effect(() => { lsSet("sn-slack-group", slackGrouping); });

  // ───── Derived ────────────────────────────────────────────────────────
  const blocks = $derived(parseMarkdown(doc.content));
  const blocksMap = $derived.by<Record<string, BlockMeta & MdBlock>>(() => {
    const map: Record<string, any> = {};
    let crumb: string[] = [];
    blocks.forEach((b, idx) => {
      if (b.kind === "heading") {
        crumb = crumb.slice(0, b.level - 1);
        crumb[b.level - 1] = b.text;
      }
      let sectionSlug: string | null = null;
      for (let k = idx; k >= 0; k--) {
        const bb = blocks[k];
        if (bb.kind === "heading" && bb.level === 2) { sectionSlug = bb.slug; break; }
      }
      if (!sectionSlug) {
        for (let k = idx; k >= 0; k--) {
          const bb = blocks[k];
          if (bb.kind === "heading") { sectionSlug = bb.slug; break; }
        }
      }
      map[b.id] = {
        ...b,
        order: idx,
        crumb: crumb.filter(Boolean).join(" › "),
        sectionSlug,
      };
    });
    return map;
  });
  const annotationsEnriched = $derived<EnrichedAnnotation[]>(
    annotations.map((a) => {
      const b = blocksMap[a.blockId];
      const line = a.line ?? b?.line ?? 0;

      // Multi-block pinpoint: range across the spanned blocks.
      if (a.blockIds && a.blockIds.length > 1) {
        const lines = a.blockIds
          .map((id) => blocksMap[id]?.line ?? line)
          .filter((n) => n > 0);
        const lineEnd = lines.length ? Math.max(...lines) : line;
        const startLine = lines.length ? Math.min(...lines) : line;
        return {
          ...a,
          blockOrder: b?.order ?? 0,
          blockCrumb: b?.crumb || "",
          line: startLine,
          lineEnd,
          locLabel: startLine === lineEnd ? `L${startLine}` : `L${startLine}–L${lineEnd}`,
        };
      }

      // Text-range within a single block: include columns when partial.
      // start/end are character offsets into the rendered block text.
      // Treat selections that cover the whole block as "no column" — just the line.
      const blockText =
        b && "text" in (b as any) ? (b as any).text as string :
        b && (b as any).kind === "list" ? ((b as any).items || []).map((i: any) => i.text).join(" ") :
        "";
      const wholeBlock = a.start === 0 && a.end >= blockText.length;
      const locLabel = wholeBlock
        ? `L${line}`
        : `L${line}:${a.start + 1}–${a.end + 1}`;

      return {
        ...a,
        blockOrder: b?.order ?? 0,
        blockCrumb: b?.crumb || "",
        line,
        lineEnd: line,
        locLabel,
      };
    }),
  );
  const sectionCounts = $derived.by<Record<string, number>>(() => {
    const c: Record<string, number> = {};
    annotationsEnriched.forEach((a) => {
      const slug = blocksMap[a.blockId]?.sectionSlug;
      if (!slug) return;
      c[slug] = (c[slug] || 0) + 1;
    });
    return c;
  });
  const headingItems = $derived(blocks.filter((b) => b.kind === "heading" && (b as any).level <= 3));
  const openAnnCount = $derived(annotationsEnriched.length);
  const typeCounts = $derived.by(() => {
    const c: Record<string, number> = { all: annotationsEnriched.length };
    TYPES.forEach((t) => { c[t.id] = 0; });
    annotationsEnriched.forEach((a) => { c[a.type]++; });
    return c;
  });
  const filteredAnnotations = $derived.by(() => {
    const all = [...annotationsEnriched].sort(
      (a, b) => a.blockOrder - b.blockOrder || a.start - b.start,
    );
    if (filter === "all") return all;
    return all.filter((a) => a.type === filter);
  });
  const searchHits = $derived.by(() => {
    if (!search.trim() || search.length < 2) return [] as { blockId: string; offset: number }[];
    const hits: { blockId: string; offset: number }[] = [];
    const q = search.toLowerCase();
    blocks.forEach((b) => {
      let text = "";
      if ("text" in b && typeof (b as any).text === "string") text = (b as any).text;
      else if (b.kind === "list") text = b.items.map((i) => i.text).join(" ");
      let idx = 0;
      const lower = text.toLowerCase();
      while ((idx = lower.indexOf(q, idx)) !== -1) {
        hits.push({ blockId: b.id, offset: idx });
        idx += q.length;
      }
    });
    return hits;
  });

  // ───── Refs ───────────────────────────────────────────────────────────
  let scrollEl = $state<HTMLDivElement | undefined>();
  let fileInputEl: HTMLInputElement;
  let searchInputEl: HTMLInputElement;
  let paletteInputEl = $state<HTMLInputElement | undefined>();

  function uid() { return "a" + Math.random().toString(36).slice(2, 8); }

  // ───── Annotation actions ─────────────────────────────────────────────
  function createAnn(type: AnnotationType, info: SelectionInfo | null) {
    if (!info) return;
    const b = blocksMap[info.blockId];
    const id = uid();
    const a: Annotation = {
      id,
      blockId: info.blockId,
      start: info.start,
      end: info.end,
      quoted: info.quoted,
      type,
      note: "",
      replacement: "",
      createdAt: Date.now(),
      line: b?.line ?? 0,
      justCreated: true,
    };
    annotations = [...annotations, a];
    activeId = id;
    selectionInfo = null;
    window.getSelection()?.removeAllRanges();
    filter = "all";
  }
  function createBlockAnn(blockId: string) {
    const b = blocksMap[blockId];
    if (!b) return;
    const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
    const txt = blockEl ? blockEl.textContent || "" : "";
    const id = uid();
    const a: Annotation = {
      id,
      blockId,
      start: 0,
      end: txt.length,
      quoted: txt.slice(0, 200),
      type: "comment",
      note: "",
      replacement: "",
      createdAt: Date.now(),
      line: b.line,
      justCreated: true,
    };
    annotations = [...annotations, a];
    activeId = id;
    filter = "all";
  }
  function createPinpointAnn(type: AnnotationType, blockIds: string[]) {
    if (blockIds.length === 0) return;
    // Order block IDs by their position in the document
    const order = new Map(blocks.map((b, i) => [b.id, i] as const));
    const ordered = [...blockIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    // Build a concatenated quoted string, capped at ~400 chars
    const parts: string[] = [];
    let total = 0;
    for (const bid of ordered) {
      const el = document.querySelector(`[data-block-id="${bid}"]`);
      const txt = (el?.textContent || "").trim();
      const slice = txt.length > 300 ? txt.slice(0, 297) + "…" : txt;
      if (total + slice.length > 400) {
        parts.push("…");
        break;
      }
      parts.push(slice);
      total += slice.length + 2; // separators
    }
    const quoted = parts.join("\n\n");
    const primary = ordered[0];
    const b = blocksMap[primary];
    const id = uid();
    const a: Annotation = {
      id,
      blockId: primary,
      blockIds: ordered,
      start: 0,
      end: 0,
      quoted,
      type,
      note: "",
      replacement: "",
      createdAt: Date.now(),
      line: b?.line ?? 0,
      justCreated: true,
    };
    annotations = [...annotations, a];
    activeId = id;
    pinpointSelected = [];
    pinpointAnchorId = null;
    filter = "all";
  }

  function onBlockClickPinpoint(e: MouseEvent, blockId: string) {
    if (!pinpointMode) return;
    e.stopPropagation();
    e.preventDefault();
    const shift = e.shiftKey;
    const mod = e.metaKey || e.ctrlKey;
    if (shift && pinpointAnchorId) {
      // Range: select all blocks between anchor and clicked (inclusive)
      const ids = blocks.map((b) => b.id);
      const a = ids.indexOf(pinpointAnchorId);
      const b = ids.indexOf(blockId);
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        pinpointSelected = ids.slice(lo, hi + 1);
      }
      return;
    }
    if (mod) {
      // Toggle this block in selection
      if (pinpointSelected.includes(blockId)) {
        pinpointSelected = pinpointSelected.filter((x) => x !== blockId);
      } else {
        pinpointSelected = [...pinpointSelected, blockId];
        pinpointAnchorId = blockId;
      }
      return;
    }
    // Plain click: replace selection with this single block
    pinpointSelected = [blockId];
    pinpointAnchorId = blockId;
  }

  // Map blockId → pinpoint annotation (whichever is active for tint)
  const pinpointAnnByBlock = $derived.by(() => {
    const m = new Map<string, EnrichedAnnotation>();
    annotationsEnriched.forEach((a) => {
      if (a.blockIds && a.blockIds.length > 0) {
        a.blockIds.forEach((bid) => {
          // Prefer active, else first-encountered
          if (!m.has(bid) || a.id === activeId) m.set(bid, a);
        });
      }
    });
    return m;
  });

  function updateAnn(id: string, patch: Partial<Annotation>) {
    annotations = annotations.map((a) => (a.id === id ? { ...a, ...patch } : a));
  }
  function deleteAnn(id: string) {
    annotations = annotations.filter((a) => a.id !== id);
    if (activeId === id) activeId = null;
  }
  function cycleAnnType(id: string, dir: 1 | -1) {
    const a = annotations.find((x) => x.id === id);
    if (!a) return;
    const idx = TYPES.findIndex((t) => t.id === a.type);
    const next = TYPES[(idx + dir + TYPES.length) % TYPES.length];
    updateAnn(id, { type: next.id });
  }

  // ───── Scroll-to / jump helpers ──────────────────────────────────────
  function jumpTo(slug: string | null, blockId: string | null) {
    let target: HTMLElement | null = null;
    if (blockId) target = document.getElementById(`blk-${blockId}`);
    else if (slug) target = document.getElementById(slug);
    if (target && scrollEl) {
      const offset = target.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
      scrollEl.scrollBy({ top: offset - 16, behavior: "smooth" });
    }
  }
  function jumpToAnn(a: EnrichedAnnotation) {
    activeId = a.id;
    jumpTo(null, a.blockId);
  }

  // ───── Selection handling ────────────────────────────────────────────
  // Pull selection info on mouseup (anywhere — not just inside .doc-wrap),
  // because the user can drag and release outside the doc.
  function refreshSelection() {
    setTimeout(() => {
      const info = getSelectionInfo();
      selectionInfo = info;
    }, 10);
  }
  function onMouseUp() { refreshSelection(); }

  // ───── File loading ──────────────────────────────────────────────────
  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      doc = { name: file.name, content: (e.target?.result as string) || "" };
      annotations = [];
      activeId = null;
      search = "";
      if (scrollEl) scrollEl.scrollTop = 0;
    };
    reader.readAsText(file);
  }
  async function openFileDialog() {
    fileInputEl?.click();
  }

  // ───── Search ────────────────────────────────────────────────────────
  $effect(() => { searchIdx = 0; void search; });
  $effect(() => {
    if (searchHits.length === 0) return;
    const h = searchHits[searchIdx % searchHits.length];
    if (h) jumpTo(null, h.blockId);
  });
  function searchNext() {
    if (searchHits.length) searchIdx = (searchIdx + 1) % searchHits.length;
  }
  function searchPrev() {
    if (searchHits.length) searchIdx = (searchIdx - 1 + searchHits.length) % searchHits.length;
  }

  // ───── Search highlighter (DOM mutation) ─────────────────────────────
  $effect(() => {
    // re-run when search or blocks change
    void search; void searchIdx; void searchHits.length; void annotations; void activeId;
    if (typeof document === "undefined") return;
    document.querySelectorAll(".search-hit").forEach((el) => {
      const p = el.parentNode!;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      p.removeChild(el);
      (p as Element).normalize?.();
    });
    if (!search.trim() || search.length < 2) return;
    const docRoot = document.querySelector(".doc");
    if (!docRoot) return;
    const q = search.toLowerCase();
    const walker = document.createTreeWalker(docRoot, NodeFilter.SHOW_TEXT, {
      acceptNode(n: Node) {
        if ((n as Text).parentElement?.closest("script,style"))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) nodes.push(n as Text);
    let counter = 0;
    nodes.forEach((node) => {
      const txt = node.nodeValue || "";
      const low = txt.toLowerCase();
      let i = 0;
      const pieces: { kind: "t" | "h"; v: string; idx?: number }[] = [];
      while (i < txt.length) {
        const j = low.indexOf(q, i);
        if (j === -1) { pieces.push({ kind: "t", v: txt.slice(i) }); break; }
        if (j > i) pieces.push({ kind: "t", v: txt.slice(i, j) });
        pieces.push({ kind: "h", v: txt.slice(j, j + q.length), idx: counter++ });
        i = j + q.length;
      }
      if (pieces.length === 1 && pieces[0].kind === "t") return;
      const f = document.createDocumentFragment();
      pieces.forEach((p) => {
        if (p.kind === "t") f.appendChild(document.createTextNode(p.v));
        else {
          const s = document.createElement("span");
          s.className =
            "search-hit" +
            (p.idx === searchIdx % Math.max(searchHits.length, 1) ? " current" : "");
          s.textContent = p.v;
          f.appendChild(s);
        }
      });
      node.parentNode!.replaceChild(f, node);
    });
  });

  // ───── Mark application (annotations) ────────────────────────────────
  $effect(() => {
    // Re-apply marks when annotations or activeId or blocks change.
    void annotations; void activeId; void blocks;
    if (typeof document === "undefined") return;
    // Defer to let block HTML render first
    void tick().then(() => {
      const byBlock = new Map<string, EnrichedAnnotation[]>();
      annotationsEnriched.forEach((a) => {
        if (!byBlock.has(a.blockId)) byBlock.set(a.blockId, []);
        byBlock.get(a.blockId)!.push(a);
      });
      document.querySelectorAll<HTMLElement>("[data-block-id]").forEach((el) => {
        clearMarks(el);
        const id = el.dataset.blockId!;
        const anns = byBlock.get(id) || [];
        const sorted = [...anns].sort((a, b) => a.start - b.start);
        sorted.forEach((a) => {
          wrapTextRange(el, a.start, a.end, {
            class:
              "annot-mark" +
              (a.id === activeId ? " active" : ""),
            "data-type": a.type,
            "data-id": a.id,
          });
        });
      });
    });
  });

  function onDocClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest(".annot-mark") as HTMLElement | null;
    if (el) {
      e.stopPropagation();
      activeId = el.dataset.id || null;
    }
  }

  // ───── Active section via scroll ─────────────────────────────────────
  function onDocScroll() {
    const el = scrollEl;
    if (!el) return;
    const headings = blocks.filter((b) => b.kind === "heading" && (b as any).level <= 3) as any[];
    if (headings.length === 0) return;

    // If the doc is scrolled to within ~40px of the bottom, force-activate the last heading.
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    if (nearBottom) {
      activeSlug = headings[headings.length - 1].slug;
      return;
    }

    // Otherwise: pick the *last* heading whose top is at or above the threshold (60px below viewport top).
    const containerTop = el.getBoundingClientRect().top;
    let current = headings[0].slug;
    for (const h of headings) {
      const node = document.getElementById(h.slug);
      if (!node) continue;
      const top = node.getBoundingClientRect().top - containerTop;
      if (top - 60 <= 0) {
        current = h.slug;
        // No early break — keep walking so we catch the lowest qualifying heading.
      }
    }
    activeSlug = current;
  }

  // ───── Output text + builders ────────────────────────────────────────
  const slackText = $derived(
    buildSlack(doc, annotationsEnriched, {
      tone: slackTone,
      groupBy: slackGrouping,
      includeQuotes: slackIncludeQuotes,
    }),
  );
  const xmlText = $derived(buildXML(doc, annotationsEnriched, { variant: agentVariant }));
  const mdText = $derived(buildMarkdown(doc, annotationsEnriched, { variant: agentVariant }));

  let modalTab = $state<"agent" | "slack">("agent");
  const currentOutputText = $derived(
    modalTab === "slack" ? slackText : agentFormat === "xml" ? xmlText : mdText,
  );

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(currentOutputText);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = currentOutputText;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        copied = true;
        setTimeout(() => { copied = false; }, 1500);
      } catch {}
      document.body.removeChild(ta);
    }
  }

  // ───── Resizer ───────────────────────────────────────────────────────
  function startResize(side: "left" | "right", e: MouseEvent) {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      if (side === "left") tocW = Math.max(180, Math.min(420, ev.clientX));
      else annW = Math.max(260, Math.min(540, window.innerWidth - ev.clientX));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // ───── Block HTML rendering ──────────────────────────────────────────
  function blockHtml(b: MdBlock): string {
    switch (b.kind) {
      case "heading":   return `<h${b.level} id="${b.slug}">${mdInline(b.text)}</h${b.level}>`;
      case "paragraph": return `<p>${mdInline(b.text)}</p>`;
      case "blockquote":return `<blockquote>${mdInline(b.text)}</blockquote>`;
      case "hr":        return `<hr/>`;
      case "code": {
        const lang = b.lang ? ` data-lang="${b.lang}"` : "";
        const escaped = b.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<pre${lang}><code>${escaped}</code></pre>`;
      }
      case "list": {
        const tag = b.ordered ? "ol" : "ul";
        return `<${tag}>${b.items.map((it) => `<li>${mdInline(it.text)}</li>`).join("")}</${tag}>`;
      }
      case "table": {
        const head = `<thead><tr>${b.header.map((c) => `<th>${mdInline(c)}</th>`).join("")}</tr></thead>`;
        const body = `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
        return `<table>${head}${body}</table>`;
      }
      default: return "";
    }
  }

  // ───── Drag-and-drop ─────────────────────────────────────────────────
  function onWinDragOver(e: DragEvent) {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      dropping = true;
    }
  }
  function onWinDragLeave(e: DragEvent) {
    if (e.clientX === 0 && e.clientY === 0) dropping = false;
  }
  function onWinDrop(e: DragEvent) {
    e.preventDefault();
    dropping = false;
    const file = e.dataTransfer?.files?.[0];
    if (
      file &&
      (file.name.endsWith(".md") ||
        file.name.endsWith(".markdown") ||
        file.name.endsWith(".mdx") ||
        file.type === "text/markdown" ||
        file.type === "text/plain")
    ) {
      loadFile(file);
    }
  }

  // ───── Keyboard model ────────────────────────────────────────────────
  let gPrefix = false;
  let gTimer: ReturnType<typeof setTimeout> | null = null;
  function clearG() {
    gPrefix = false;
    if (gTimer) { clearTimeout(gTimer); gTimer = null; }
  }

  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    const inField =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      (e.target as HTMLElement).isContentEditable;
    const mod = e.metaKey || e.ctrlKey;

    // Always: Escape closes modals + clears state
    if (e.key === "Escape") {
      if (paletteOpen) { paletteOpen = false; return; }
      if (cheatOpen) { cheatOpen = false; return; }
      if (outputOpen) { outputOpen = false; return; }
      if (settingsOpen) { settingsOpen = false; return; }
      selectionInfo = null;
      activeId = null;
      window.getSelection()?.removeAllRanges();
      if (pinpointSelected.length > 0) { pinpointSelected = []; pinpointAnchorId = null; }
      else if (pinpointMode) { pinpointMode = false; }
      if (search) search = "";
      return;
    }

    // Global mod-shortcuts (work even in form fields for some)
    if (mod && e.key === "o") { e.preventDefault(); openFileDialog(); return; }
    if (mod && e.key === "k") {
      e.preventDefault();
      searchInputEl?.focus();
      searchInputEl?.select();
      return;
    }
    if (mod && e.key === "p") {
      e.preventDefault();
      paletteOpen = true;
      setTimeout(() => paletteInputEl?.focus(), 30);
      return;
    }
    if (mod && (e.key === "Enter" || e.key === "Return")) {
      e.preventDefault();
      modalTab = e.shiftKey ? "slack" : "agent";
      outputOpen = true;
      return;
    }
    if (mod && e.key === ",") { e.preventDefault(); settingsOpen = true; return; }
    if (mod && e.key === "1") { e.preventDefault(); focusContext = "toc"; return; }
    if (mod && e.key === "2") { e.preventDefault(); focusContext = "doc"; return; }
    if (mod && e.key === "3") { e.preventDefault(); focusContext = "annotations"; return; }

    if (inField) return;

    if (e.key === "?" && !mod) { e.preventDefault(); cheatOpen = !cheatOpen; return; }
    if (e.key === "Tab" && !mod) {
      e.preventDefault();
      const order: ("toc" | "doc" | "annotations")[] = ["toc", "doc", "annotations"];
      const i = order.indexOf(focusContext);
      const next = order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length];
      focusContext = next;
      return;
    }

    // Pinpoint mode toggle
    if (e.key === "b" && !e.shiftKey && !mod) {
      e.preventDefault();
      togglePinpoint();
      return;
    }

    // When pinpoint selection is active, type-letter shortcuts create a block annotation
    if (pinpointMode && pinpointSelected.length > 0) {
      const k = e.key.toLowerCase();
      const map: Record<string, AnnotationType> = {
        c: "comment", r: "replace", d: "delete", a: "add", q: "question", k: "approve",
      };
      if (map[k]) { e.preventDefault(); createPinpointAnn(map[k], pinpointSelected); return; }
    }

    // When text selection is active, type-letter shortcuts create annotation
    if (selectionInfo) {
      const k = e.key.toLowerCase();
      const map: Record<string, AnnotationType> = {
        c: "comment", r: "replace", d: "delete", a: "add", q: "question", k: "approve",
      };
      if (map[k]) { e.preventDefault(); createAnn(map[k], selectionInfo); return; }
    }

    // 'g' two-key prefix for gg / G handled per-context below
    if (e.key === "g" && !e.shiftKey && !mod) {
      if (gPrefix) {
        // gg → top of doc
        clearG();
        scrollEl?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      gPrefix = true;
      gTimer = setTimeout(clearG, 600);
      return;
    }
    if (e.key === "G" && !mod) {
      clearG();
      scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
      return;
    }

    // Document context shortcuts
    if (focusContext === "doc") {
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        focusNextBlock(1);
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        focusNextBlock(-1);
        return;
      }
      if (e.key === "f" && !e.shiftKey) { e.preventDefault(); jumpHeading(1); return; }
      if (e.key === "F") { e.preventDefault(); jumpHeading(-1); return; }
      if (e.key === "m" && !e.shiftKey) { e.preventDefault(); jumpAnchor(1); return; }
      if (e.key === "M") { e.preventDefault(); jumpAnchor(-1); return; }
      if (e.key === "n" && !mod) { e.preventDefault(); searchNext(); return; }
      if (e.key === "N" && !mod) { e.preventDefault(); searchPrev(); return; }
    }
    if (focusContext === "annotations") {
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        cycleAnnotationFocus(1); return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        cycleAnnotationFocus(-1); return;
      }
      if ((e.key === "x" || e.key === "Delete") && focusedAnnotationId) { e.preventDefault(); deleteAnn(focusedAnnotationId); return; }
      if (e.key === "t" && focusedAnnotationId) { e.preventDefault(); cycleAnnType(focusedAnnotationId, 1); return; }
      if (e.key === "T" && focusedAnnotationId) { e.preventDefault(); cycleAnnType(focusedAnnotationId, -1); return; }
      if (e.key === "o" && focusedAnnotationId) {
        e.preventDefault();
        const a = annotationsEnriched.find((x) => x.id === focusedAnnotationId);
        if (a) jumpToAnn(a);
        return;
      }
    }
    if (focusContext === "toc") {
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault(); cycleHeadingFocus(1); return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault(); cycleHeadingFocus(-1); return;
      }
      if (e.key === "Enter" && focusedHeadingSlug) {
        e.preventDefault();
        const b = headingItems.find((h: any) => h.slug === focusedHeadingSlug);
        if (b) jumpTo((b as any).slug, b.id);
        focusContext = "doc";
        return;
      }
    }
  }

  function focusNextBlock(dir: 1 | -1) {
    const ids = blocks.map((b) => b.id);
    const i = focusedBlockId ? ids.indexOf(focusedBlockId) : -1;
    const next = i < 0 ? (dir === 1 ? ids[0] : ids[ids.length - 1]) : ids[Math.max(0, Math.min(ids.length - 1, i + dir))];
    focusedBlockId = next;
    const el = document.getElementById(`blk-${next}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function jumpHeading(dir: 1 | -1) {
    const hs = headingItems as any[];
    if (hs.length === 0) return;
    const i = focusedHeadingSlug ? hs.findIndex((h) => h.slug === focusedHeadingSlug) : -1;
    const next = i < 0 ? (dir === 1 ? 0 : hs.length - 1) : Math.max(0, Math.min(hs.length - 1, i + dir));
    focusedHeadingSlug = hs[next].slug;
    jumpTo(hs[next].slug, hs[next].id);
  }
  function jumpAnchor(dir: 1 | -1) {
    const inOrder = [...annotationsEnriched].sort((a, b) => a.blockOrder - b.blockOrder || a.start - b.start);
    if (inOrder.length === 0) return;
    const i = focusedAnnotationId ? inOrder.findIndex((a) => a.id === focusedAnnotationId) : -1;
    const next = i < 0 ? (dir === 1 ? 0 : inOrder.length - 1) : Math.max(0, Math.min(inOrder.length - 1, i + dir));
    const a = inOrder[next];
    focusedAnnotationId = a.id;
    jumpToAnn(a);
  }
  function cycleAnnotationFocus(dir: 1 | -1) {
    const list = filteredAnnotations;
    if (list.length === 0) return;
    const i = focusedAnnotationId ? list.findIndex((a) => a.id === focusedAnnotationId) : -1;
    const next = i < 0 ? (dir === 1 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + dir));
    focusedAnnotationId = list[next].id;
    activeId = list[next].id;
  }
  function cycleHeadingFocus(dir: 1 | -1) {
    const hs = headingItems as any[];
    if (hs.length === 0) return;
    const i = focusedHeadingSlug ? hs.findIndex((h) => h.slug === focusedHeadingSlug) : -1;
    const next = i < 0 ? (dir === 1 ? 0 : hs.length - 1) : Math.max(0, Math.min(hs.length - 1, i + dir));
    focusedHeadingSlug = hs[next].slug;
  }

  // ───── Command palette items ─────────────────────────────────────────
  interface PaletteItem {
    kind: "action" | "heading" | "annotation";
    label: string;
    sub?: string;
    onPick: () => void;
  }
  let paletteQuery = $state("");
  const paletteItems = $derived.by<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      { kind: "action", label: "Open file…", onPick: openFileDialog },
      { kind: "action", label: "Copy Agent Prompt (XML)", onPick: () => { agentFormat = "xml"; modalTab = "agent"; outputOpen = true; } },
      { kind: "action", label: "Copy Agent Prompt (Markdown)", onPick: () => { agentFormat = "markdown"; modalTab = "agent"; outputOpen = true; } },
      { kind: "action", label: "Copy Slack Message", onPick: () => { modalTab = "slack"; outputOpen = true; } },
      { kind: "action", label: pinpointMode ? "Exit pinpoint mode" : "Enter pinpoint mode", onPick: togglePinpoint },
      { kind: "action", label: `Toggle theme (current: ${theme})`, onPick: () => { theme = theme === "dark" ? "light" : "dark"; } },
      { kind: "action", label: "Settings…", onPick: () => { settingsOpen = true; } },
      { kind: "action", label: "Show keyboard shortcuts", onPick: () => { cheatOpen = true; } },
    ];
    (headingItems as any[]).forEach((h) => {
      items.push({
        kind: "heading",
        label: `Go to: ${h.text}`,
        sub: `H${h.level}`,
        onPick: () => { jumpTo(h.slug, h.id); paletteOpen = false; },
      });
    });
    annotationsEnriched.forEach((a) => {
      items.push({
        kind: "annotation",
        label: `${TYPE_BY_ID[a.type].label}: ${a.quoted.slice(0, 60)}`,
        sub: `${a.blockCrumb} · ${a.locLabel}`,
        onPick: () => { jumpToAnn(a); paletteOpen = false; },
      });
    });
    if (!paletteQuery.trim()) return items.slice(0, 12);
    const q = paletteQuery.toLowerCase();
    return items
      .filter((it) => it.label.toLowerCase().includes(q) || (it.sub || "").toLowerCase().includes(q))
      .slice(0, 30);
  });
  let palettePick = $state(0);
  $effect(() => { void paletteQuery; palettePick = 0; });
  function onPaletteKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "j")) {
      e.preventDefault();
      palettePick = Math.min(paletteItems.length - 1, palettePick + 1);
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "k")) {
      e.preventDefault();
      palettePick = Math.max(0, palettePick - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      paletteItems[palettePick]?.onPick();
      paletteOpen = false;
      paletteQuery = "";
    }
  }
</script>

<svelte:window
  onkeydown={onKey}
  onmouseup={onMouseUp}
  ondragover={onWinDragOver}
  ondragleave={onWinDragLeave}
  ondrop={onWinDrop}
/>

<svelte:document onselectionchange={() => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    selectionInfo = null;
    return;
  }
  // Re-evaluate selection info when the selection changes (e.g. keyboard
  // selection, double/triple-click). The mouseup path handles drag-end;
  // this one handles every other way a selection can come into being.
  refreshSelection();
}} />

<div class="app">
  <!-- Header -->
  <div class="header">
    <div class="brand">
      <div class="brand-mark">S</div>
      <span>Spec-notator</span>
    </div>
    <div class="brand-doc" title={doc.name}>{doc.name}</div>
    <div class="hd-spacer"></div>
    <div class="hd-search">
      <Search size={14} strokeWidth={1.6} />
      <input
        bind:this={searchInputEl}
        placeholder="Search in document…"
        bind:value={search}
        onkeydown={(e) => {
          if (e.key === "Enter") { e.shiftKey ? searchPrev() : searchNext(); }
          if (e.key === "Escape") { (e.target as HTMLInputElement).blur(); search = ""; }
        }}
      />
      {#if searchHits.length > 0}
        <span style="font-family:'Geist Mono',monospace;font-size:10px;color:var(--text-mute)">
          {searchIdx + 1}/{searchHits.length}
        </span>
      {/if}
      <kbd>⌘K</kbd>
    </div>
    <div class="hd-spacer"></div>
    <div class="hd-actions">
      <button class="btn ghost" onclick={openFileDialog} title="Open .md file (⌘O)" aria-label="Open file">
        <FileSearch size={14} strokeWidth={1.6} />
        Open
      </button>
      <div class="mode-switch" role="group" aria-label="Selection mode">
        <button
          class={!pinpointMode ? "active" : ""}
          onclick={() => { if (pinpointMode) togglePinpoint(); }}
          title="Select mode — drag through text to annotate spans"
          aria-pressed={!pinpointMode}
        >
          <MousePointer2 size={13} strokeWidth={1.8} />
          Select
        </button>
        <button
          class={(pinpointMode ? "active is-pinpoint" : "")}
          onclick={() => { if (!pinpointMode) togglePinpoint(); }}
          title="Pinpoint mode — click whole blocks to annotate (B)"
          aria-pressed={pinpointMode}
        >
          <Crosshair size={13} strokeWidth={1.8} />
          Pinpoint
        </button>
      </div>
      <button class="btn ghost icon" onclick={() => { theme = theme === "dark" ? "light" : "dark"; }} title="Toggle theme" aria-label="Toggle theme">
        {#if theme === "dark"}
          <Sun size={14} strokeWidth={1.6} />
        {:else}
          <Moon size={14} strokeWidth={1.6} />
        {/if}
      </button>
      <button class="btn primary" onclick={() => { modalTab = "agent"; outputOpen = true; }} title="Generate output prompt (⌘↵)">
        <Send size={14} strokeWidth={1.8} />
        Generate
        {#if openAnnCount > 0}
          <span class="dot">{openAnnCount}</span>
        {/if}
      </button>
    </div>
  </div>

  <input
    bind:this={fileInputEl}
    type="file"
    accept=".md,.markdown,.mdx,text/markdown,text/plain"
    style="display:none"
    onchange={(e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) loadFile(f);
      (e.target as HTMLInputElement).value = "";
    }}
  />

  <!-- Body -->
  <div
    class={"body" + (pinpointMode ? " pinpoint" : "")}
    style={`--toc-w:${tocW}px; --ann-w:${annW}px`}
  >
    <!-- TOC -->
    <div
      class="toc"
      style={focusContext === "toc" ? "box-shadow: inset 2px 0 0 var(--line-strong)" : ""}
      onclick={() => { focusContext = "toc"; }}
      role="navigation"
      aria-label="Contents"
    >
      <div class="toc-hd"><span>Contents</span></div>
      <div class="toc-doc-name">{doc.name}</div>
      {#each headingItems as b (b.id)}
        {@const h = b as any}
        <div
          class={"toc-item h" + h.level + (h.slug === activeSlug ? " active" : "") + (h.slug === focusedHeadingSlug ? " focused" : "")}
          onclick={() => { jumpTo(h.slug, h.id); }}
          role="link"
          tabindex="0"
        >
          <span>{h.text}</span>
          {#if sectionCounts[h.slug] > 0}
            <span class="ct">{sectionCounts[h.slug]}</span>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Document -->
    <div
      class="doc-wrap"
      bind:this={scrollEl}
      onmouseup={onMouseUp}
      onscroll={onDocScroll}
      onclick={(e) => { focusContext = "doc"; onDocClick(e); }}
      style=""
    >
      <div class="doc">
        <div class="doc-meta">
          <span class="pill">MD</span>
          <span>·</span>
          <span>{doc.name}</span>
        </div>
        {#each blocks as b (b.id)}
          {@const ppAnn = pinpointAnnByBlock.get(b.id)}
          <div
            class={
              "block" +
              (focusedBlockId === b.id ? " focused" : "") +
              (pinpointMode && pinpointSelected.includes(b.id) ? " pp-selected" : "") +
              (ppAnn ? " pp-annot" : "") +
              (ppAnn && ppAnn.id === activeId ? " pp-active" : "")
            }
            data-pp-type={ppAnn?.type || null}
            id={`blk-${b.id}`}
            onclick={(e) => onBlockClickPinpoint(e, b.id)}
          >
            <span class="ln">L{b.line}</span>
            <button
              class="margin-add"
              data-style={toolbarStyle}
              title="Add comment to this block"
              aria-label="Add comment to block"
              onclick={(e) => { e.stopPropagation(); createBlockAnn(b.id); }}
            >
              <Plus size={12} strokeWidth={1.8} />
            </button>
            <div
              class="block-body"
              data-block-id={b.id}
            >{@html blockHtml(b)}</div>
          </div>
        {/each}
        <div class="doc-end" aria-label="End of document"></div>
      </div>

      <!-- Minimap -->
      <div class="minimap">
        {#each annotationsEnriched as a (a.id)}
          {@const top = ((document.getElementById(`blk-${a.blockId}`)?.offsetTop || 0) / Math.max(scrollEl?.scrollHeight || 1, 1)) * 100}
          <div
            class="minimap-marker"
            style={`top:${top}%;background:var(--c-${a.type});opacity:0.75`}
            title={a.note || a.quoted}
            onclick={() => jumpToAnn(a)}
          ></div>
        {/each}
      </div>
    </div>

    <!-- Annotations rail -->
    <div
      class="annotations"
      style={focusContext === "annotations" ? "box-shadow: inset 2px 0 0 var(--line-strong)" : ""}
      onclick={() => { focusContext = "annotations"; }}
      role="region"
      aria-label="Annotations"
    >
        <div class="ann-hd">
          Annotations
          {#if openAnnCount > 0}
            <span class="ann-count">{openAnnCount}</span>
          {/if}
          <div class="spacer"></div>
        </div>
        <div class="ann-filter">
          <button class={"ann-filter-btn" + (filter === "all" ? " active" : "")} onclick={() => { filter = "all"; }}>
            All <span style="opacity:0.6">{typeCounts.open}</span>
          </button>
          {#each TYPES as t (t.id)}
            {#if typeCounts[t.id] > 0}
              <button
                class={"ann-filter-btn" + (filter === t.id ? " active" : "")}
                onclick={() => { filter = t.id; }}
                title={t.label}
              >
                <span class="type-dot" data-t={t.id} style="display:inline-block;width:8px;height:8px;border-radius:99px"></span>
                {t.label}
                <span style="opacity:0.6">{typeCounts[t.id]}</span>
              </button>
            {/if}
          {/each}
        </div>
        <div class="ann-list">
          {#if filteredAnnotations.length === 0}
            <div class="ann-empty">
              <div class="ico"><MessageSquare size={28} strokeWidth={1.4} /></div>
              <div><b>No annotations yet</b></div>
              <div style="margin-top:4px;opacity:0.8">
                Select text in the document, or hover a paragraph and click + in the margin.
              </div>
            </div>
          {/if}
          {#each filteredAnnotations as a (a.id)}
            {@const blk = blocksMap[a.blockId]}
            <div
              class={"a-card" + (a.id === activeId ? " active" : "") + (a.id === focusedAnnotationId ? " focused" : "")}
              onclick={() => { activeId = a.id; jumpToAnn(a); }}
              role="button"
              tabindex="0"
            >
              <div class="a-head">
                <span class="a-type" data-t={a.type}></span>
                <span class="a-type-label">{TYPE_BY_ID[a.type].label}</span>
                <span class="a-crumb">{blk?.crumb || "—"} · {a.locLabel}</span>
                <div class="a-actions" onclick={(e) => e.stopPropagation()}>
                  <button class="a-act" title="Delete (X)" aria-label="Delete" onclick={() => deleteAnn(a.id)}>
                    <Trash2 size={13} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
              {#if a.quoted}
                <div class="a-quote" title={a.quoted}>"{a.quoted}"</div>
              {/if}
              <div class="a-note" onclick={(e) => e.stopPropagation()}>
                <textarea
                  value={a.note}
                  oninput={(e) => {
                    const el = e.target as HTMLTextAreaElement;
                    updateAnn(a.id, { note: el.value });
                    el.style.height = "auto";
                    el.style.height = el.scrollHeight + "px";
                  }}
                  onfocus={(e) => {
                    const el = e.target as HTMLTextAreaElement;
                    el.style.height = "auto";
                    el.style.height = el.scrollHeight + "px";
                  }}
                  rows={1}
                  placeholder={
                    a.type === "approve" ? "Approve note (optional)…" :
                    a.type === "delete"  ? "Reason (optional)…" :
                    a.type === "question"? "What's your question?" :
                    a.type === "replace" ? "Why this rewrite? (optional)" :
                    a.type === "add"     ? "What should be added? (optional reason)" :
                                           "Comment…"
                  }
                ></textarea>
              </div>
              {#if a.type === "replace" || a.type === "add"}
                <div class="a-replacement" data-mode={a.type} onclick={(e) => e.stopPropagation()}>
                  <div class="a-rep-label">{a.type === "replace" ? "Rewrite as" : "Insert"}</div>
                  <textarea
                    value={a.replacement || ""}
                    oninput={(e) => {
                      const el = e.target as HTMLTextAreaElement;
                      updateAnn(a.id, { replacement: el.value });
                      el.style.height = "auto";
                      el.style.height = el.scrollHeight + "px";
                    }}
                    onfocus={(e) => {
                      const el = e.target as HTMLTextAreaElement;
                      el.style.height = "auto";
                      el.style.height = el.scrollHeight + "px";
                    }}
                    rows={2}
                    placeholder={a.type === "replace" ? "Type the new wording…" : "Type the new content…"}
                  ></textarea>
                </div>
              {/if}
            </div>
          {/each}
        </div>
    </div>

    <div
      class="resizer"
      style="left:var(--toc-w);margin-left:-3px"
      onmousedown={(e) => startResize("left", e)}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize contents panel"
    ></div>
    <div
      class="resizer"
      style="right:var(--ann-w);margin-right:-3px"
      onmousedown={(e) => startResize("right", e)}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize annotations panel"
    ></div>
  </div>

  <!-- Selection toolbar -->
  {#if selectionInfo}
    {@const sty = toolbarStyle === "floating"
      ? `left:${(selectionInfo.rect.left + selectionInfo.rect.right) / 2}px;top:${selectionInfo.rect.top - 44}px`
      : `left:${selectionInfo.rect.left}px;top:${selectionInfo.rect.bottom + 6}px;transform:none;position:fixed`}
    <div
      class={"toolbar" + (toolbarStyle === "inline" ? " inline" : "")}
      style={sty}
      onmousedown={(e) => e.preventDefault()}
    >
      {#each TYPES as t (t.id)}
        {@const TIcon = TYPE_ICON[t.id]}
        <button
          class="tb-btn"
          data-t={t.id}
          title={`${t.hint}  (${t.shortcut})`}
          onclick={() => createAnn(t.id, selectionInfo)}
        >
          <span class="type-dot"></span>
          <span class="tb-ico"><TIcon size={13} strokeWidth={1.8} /></span>
          {t.label}
        </button>
      {/each}
      <div class="tb-sep"></div>
      <button class="tb-btn" onclick={() => { selectionInfo = null; window.getSelection()?.removeAllRanges(); }} title="Cancel (Esc)" aria-label="Cancel">
        <X size={13} strokeWidth={1.8} />
      </button>
    </div>
  {/if}

  <!-- Output modal -->
  {#if outputOpen}
    <div class="modal-bg" onclick={() => { outputOpen = false; }} role="dialog" aria-modal="true">
      <div class="modal" onclick={(e) => e.stopPropagation()}>
        <div class="modal-hd">
          <h2>Generate review output</h2>
          <div class="spacer"></div>
          <span style="font-size:11px;color:var(--text-dim);font-family:'Geist Mono',monospace">
            {openAnnCount} annotation{openAnnCount === 1 ? "" : "s"}
          </span>
          <button class="btn ghost icon" onclick={() => { outputOpen = false; }} aria-label="Close"><X size={14} strokeWidth={1.8} /></button>
        </div>
        <div class="modal-tabs">
          <button class={"modal-tab" + (modalTab === "agent" ? " active" : "")} onclick={() => { modalTab = "agent"; }}>
            <Send size={13} strokeWidth={1.8} /> Agent prompt
          </button>
          <button class={"modal-tab" + (modalTab === "slack" ? " active" : "")} onclick={() => { modalTab = "slack"; }}>
            <MessageSquare size={13} strokeWidth={1.8} /> Slack message
          </button>
        </div>
        <div class="modal-body">
          <div class="modal-side">
            {#if modalTab === "agent"}
              <div>
                <h4>Format</h4>
                <div class="fmt-toggle">
                  <button class={agentFormat === "xml" ? "active" : ""} onclick={() => { agentFormat = "xml"; }}>XML</button>
                  <button class={agentFormat === "markdown" ? "active" : ""} onclick={() => { agentFormat = "markdown"; }}>Markdown</button>
                </div>
              </div>
              <div>
                <h4>Variant</h4>
                <div class="opt-grp">
                  {#each [
                    { id: "structured", label: "Structured review", desc: agentFormat === "xml" ? "<review_session> with typed annotations + instruction block." : "Sectioned markdown grouped by annotation type, with instructions." },
                    { id: "patch",      label: "Patch instructions", desc: agentFormat === "xml" ? "<review> of <change> elements — terse, diff-like." : "## Changes section with one entry per annotation, diff-like." },
                    { id: "task",       label: "Step-by-step task",  desc: agentFormat === "xml" ? "<task> with imperative <step>s for an agent to execute." : "Numbered imperative instructions for an agent." },
                  ] as o (o.id)}
                    <div
                      class={"opt" + (agentVariant === o.id ? " active" : "")}
                      onclick={() => { agentVariant = o.id as AgentVariant; }}
                      role="button"
                      tabindex="0"
                    >
                      <div>
                        <div>{o.label}</div>
                        <div class="opt-desc">{o.desc}</div>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {:else}
              <div>
                <h4>Tone</h4>
                <div class="opt-grp">
                  {#each [
                    { id: "casual",  label: "Casual",   desc: "Quick and friendly, with emoji." },
                    { id: "neutral", label: "Neutral",  desc: "Direct, no flourish." },
                  ] as o (o.id)}
                    <div
                      class={"opt" + (slackTone === o.id ? " active" : "")}
                      onclick={() => { slackTone = o.id as SlackTone; }}
                      role="button" tabindex="0"
                    >
                      <div>
                        <div>{o.label}</div>
                        <div class="opt-desc">{o.desc}</div>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
              <div>
                <h4>Grouping</h4>
                <div class="opt-grp">
                  {#each [
                    { id: "order", label: "Document order", desc: "Walk top to bottom." },
                    { id: "type",  label: "By annotation type", desc: "Group comments, rewrites, etc." },
                  ] as o (o.id)}
                    <div
                      class={"opt" + (slackGrouping === o.id ? " active" : "")}
                      onclick={() => { slackGrouping = o.id as SlackGrouping; }}
                      role="button" tabindex="0"
                    >
                      <div>
                        <div>{o.label}</div>
                        <div class="opt-desc">{o.desc}</div>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
              <div>
                <h4>Include</h4>
                <div class="opt-grp">
                  <div
                    class={"opt" + (slackIncludeQuotes ? " active" : "")}
                    onclick={() => { slackIncludeQuotes = !slackIncludeQuotes; }}
                    role="button" tabindex="0"
                  >
                    <div>
                      <div>Quoted text snippets</div>
                      <div class="opt-desc">Show what each note refers to.</div>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </div>

          <div class={"modal-out" + (modalTab === "slack" ? " slack" : "")}>
            <button class="btn copy" onclick={copyOutput}>
              {#if copied}<Check size={13} strokeWidth={2} /> Copied{:else}<CopyIcon size={13} strokeWidth={1.8} /> Copy{/if}
            </button>
            {#if modalTab === "slack"}
              <div class="slack-msg">
                {#each slackText.split("\n") as line, i}
                  {#if line.startsWith("> ")}
                    <div class="slack-quote">{line.slice(2)}</div>
                  {:else if line.trim() === ""}
                    <div style="height:6px"></div>
                  {:else}
                    {@html line
                      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                      .replace(/`([^`]+)`/g, '<span class="slack-code">$1</span>')
                      .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
                      .replace(/_([^_\n]+)_/g, "<em>$1</em>")
                      .replace(/:(\w+):/g, (_, name) => {
                        const map: Record<string,string> = { speech_balloon: "💬", pencil2: "✏️", wastebasket: "🗑", heavy_plus_sign: "➕", question: "❓", white_check_mark: "✅" };
                        return map[name] || ":" + name + ":";
                      })}
                  {/if}
                {/each}
              </div>
            {:else if agentFormat === "xml"}
              <div>{@html syntaxHighlightXml(xmlText)}</div>
            {:else}
              <div>{@html syntaxHighlightMarkdown(mdText)}</div>
            {/if}
          </div>
        </div>
        <div class="modal-foot">
          <span class="stat">{currentOutputText.length.toLocaleString()} chars · {currentOutputText.split("\n").length} lines</span>
          <div class="spacer"></div>
          <button class="btn" onclick={() => { outputOpen = false; }}>Close</button>
          <button class="btn primary" onclick={copyOutput}>
            {#if copied}<Check size={13} strokeWidth={2} /> Copied to clipboard{:else}<CopyIcon size={13} strokeWidth={1.8} /> {modalTab === "slack" ? "Copy Slack message" : agentFormat === "xml" ? "Copy XML prompt" : "Copy Markdown prompt"}{/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Settings modal -->
  {#if settingsOpen}
    <div class="modal-bg" onclick={() => { settingsOpen = false; }} role="dialog" aria-modal="true">
      <div class="modal" style="width:min(560px, calc(100vw - 48px))" onclick={(e) => e.stopPropagation()}>
        <div class="modal-hd">
          <h2>Settings</h2>
          <div class="spacer"></div>
          <button class="btn ghost icon" onclick={() => { settingsOpen = false; }} aria-label="Close"><X size={14} strokeWidth={1.8} /></button>
        </div>
        <div class="modal-body" style="grid-template-columns:1fr">
          <div style="display:flex;flex-direction:column;gap:14px;font-size:12px">
            <div>
              <h4>Theme</h4>
              <div class="fmt-toggle">
                <button class={theme === "dark" ? "active" : ""} onclick={() => { theme = "dark"; }}>Dark</button>
                <button class={theme === "light" ? "active" : ""} onclick={() => { theme = "light"; }}>Light</button>
              </div>
            </div>
            <div>
              <h4>Selection toolbar style</h4>
              <div class="fmt-toggle">
                <button class={toolbarStyle === "floating" ? "active" : ""} onclick={() => { toolbarStyle = "floating"; }}>Floating</button>
                <button class={toolbarStyle === "inline" ? "active" : ""} onclick={() => { toolbarStyle = "inline"; }}>Inline</button>
                <button class={toolbarStyle === "margin" ? "active" : ""} onclick={() => { toolbarStyle = "margin"; }}>Margin</button>
              </div>
            </div>
            <div>
              <h4>Default agent format</h4>
              <div class="fmt-toggle">
                <button class={agentFormat === "xml" ? "active" : ""} onclick={() => { agentFormat = "xml"; }}>XML</button>
                <button class={agentFormat === "markdown" ? "active" : ""} onclick={() => { agentFormat = "markdown"; }}>Markdown</button>
              </div>
            </div>
            <div>
              <h4>Default agent variant</h4>
              <div class="fmt-toggle">
                <button class={agentVariant === "structured" ? "active" : ""} onclick={() => { agentVariant = "structured"; }}>Structured</button>
                <button class={agentVariant === "patch" ? "active" : ""} onclick={() => { agentVariant = "patch"; }}>Patch</button>
                <button class={agentVariant === "task" ? "active" : ""} onclick={() => { agentVariant = "task"; }}>Task</button>
              </div>
            </div>
            <div>
              <h4>Default Slack tone</h4>
              <div class="fmt-toggle">
                <button class={slackTone === "casual" ? "active" : ""} onclick={() => { slackTone = "casual"; }}>Casual</button>
                <button class={slackTone === "neutral" ? "active" : ""} onclick={() => { slackTone = "neutral"; }}>Neutral</button>
              </div>
            </div>
            <div>
              <h4>Data</h4>
              <button class="btn" onclick={() => { if (confirm("Clear all annotations on this document?")) { annotations = []; activeId = null; } }}>
                Clear all annotations
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Command palette -->
  {#if paletteOpen}
    <div class="modal-bg" onclick={() => { paletteOpen = false; }} role="dialog" aria-modal="true">
      <div
        class="modal"
        style="width:min(580px, calc(100vw - 48px));max-height:60vh"
        onclick={(e) => e.stopPropagation()}
      >
        <div style="padding:10px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px">
          <span style="color:var(--text-dim);font-family:'Geist Mono',monospace;font-size:11px">⌘P</span>
          <input
            bind:this={paletteInputEl}
            bind:value={paletteQuery}
            onkeydown={onPaletteKey}
            placeholder="Type a command, heading, or annotation…"
            style="flex:1;background:transparent;border:0;outline:0;color:var(--text);font:inherit;font-size:14px;padding:6px 0"
          />
        </div>
        <div style="overflow-y:auto;max-height:calc(60vh - 60px);padding:6px 0">
          {#each paletteItems as item, i}
            <div
              role="button"
              tabindex="0"
              onclick={() => { item.onPick(); paletteOpen = false; paletteQuery = ""; }}
              style={`padding:8px 14px;cursor:pointer;display:flex;gap:10px;align-items:center;${i === palettePick ? "background:var(--accent-soft);color:var(--text)" : "color:var(--text-mute)"}`}
            >
              <span style="font-family:'Geist Mono',monospace;font-size:10px;color:var(--text-dim);min-width:60px">
                {item.kind === "action" ? "ACTION" : item.kind === "heading" ? "GO TO" : "ANNOT"}
              </span>
              <span style="flex:1;font-size:13px">{item.label}</span>
              {#if item.sub}
                <span style="font-size:11px;color:var(--text-dim);font-family:'Geist Mono',monospace">{item.sub}</span>
              {/if}
            </div>
          {/each}
          {#if paletteItems.length === 0}
            <div style="padding:20px;text-align:center;color:var(--text-dim);font-size:12px">No matches.</div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Cheat sheet overlay -->
  {#if cheatOpen}
    <div class="modal-bg" onclick={() => { cheatOpen = false; }} role="dialog" aria-modal="true">
      <div
        class="modal"
        style="width:min(720px, calc(100vw - 48px));max-height:80vh"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="modal-hd">
          <h2>Keyboard shortcuts</h2>
          <div class="spacer"></div>
          <button class="btn ghost icon" onclick={() => { cheatOpen = false; }} aria-label="Close"><X size={14} strokeWidth={1.8} /></button>
        </div>
        <div class="modal-body" style="grid-template-columns:1fr 1fr;font-size:12px">
          <div>
            <h4>Global</h4>
            <table style="width:100%;border-collapse:collapse">
              <tbody>
                {#each [
                  ["⌘O", "Open file"],
                  ["⌘P", "Command palette"],
                  ["⌘K", "Focus search"],
                  ["⌘↵", "Generate output (Agent)"],
                  ["⌘⇧↵", "Generate output (Slack)"],
                  ["⌘,", "Settings"],
                  ["⌘1/2/3", "Focus TOC / Doc / Annotations"],
                  ["Tab", "Cycle focus context"],
                  ["B", "Toggle Select ⇄ Pinpoint mode"],
                  ["?", "This cheat sheet"],
                  ["Esc", "Dismiss / close"],
                ] as [k, v]}
                  <tr><td style="padding:4px 0"><kbd>{k}</kbd></td><td style="padding:4px 8px;color:var(--text-mute)">{v}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div>
            <h4>Document context</h4>
            <table style="width:100%;border-collapse:collapse">
              <tbody>
                {#each [
                  ["j / ↓", "Next block"],
                  ["k / ↑", "Previous block"],
                  ["g g", "Top of document"],
                  ["G", "Bottom of document"],
                  ["f / F", "Next / prev heading"],
                  ["m / M", "Next / prev annotation"],
                  ["n / N", "Next / prev search hit"],
                  ["C R D A Q K", "Create annotation from selection"],
                ] as [k, v]}
                  <tr><td style="padding:4px 0"><kbd>{k}</kbd></td><td style="padding:4px 8px;color:var(--text-mute)">{v}</td></tr>
                {/each}
              </tbody>
            </table>
            <h4 style="margin-top:14px">Annotations context</h4>
            <table style="width:100%;border-collapse:collapse">
              <tbody>
                {#each [
                  ["j / k", "Next / prev card"],
                  ["Space", "Toggle resolve"],
                  ["x / Del", "Delete annotation"],
                  ["o", "Jump to anchor in document"],
                  ["t / T", "Cycle type forward / back"],
                ] as [k, v]}
                  <tr><td style="padding:4px 0"><kbd>{k}</kbd></td><td style="padding:4px 8px;color:var(--text-mute)">{v}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Drop overlay -->
  {#if dropping}
    <div class="drop-overlay">
      <div class="dz">
        Drop a markdown file to load it
        <div class="sub">.md, .markdown, or .mdx</div>
      </div>
    </div>
  {/if}

  <!-- Pinpoint banner -->
  {#if pinpointMode}
    <div class="pp-banner">
      Pinpoint mode
      {#if pinpointSelected.length > 0}
        <span class="pp-count">{pinpointSelected.length} block{pinpointSelected.length === 1 ? "" : "s"}</span>
        <span style="opacity:0.85;text-transform:none">→ press <kbd>C</kbd> <kbd>R</kbd> <kbd>D</kbd> <kbd>A</kbd> <kbd>Q</kbd> <kbd>K</kbd></span>
      {:else}
        <span style="opacity:0.85;text-transform:none">Click blocks · ⇧-click to range · ⌘-click to add · <kbd>B</kbd> to exit</span>
      {/if}
    </div>
  {/if}

  <!-- Shortcuts hint -->
  {#if !pinpointMode}
    <div class="shortcuts-hint">
      Select text → <kbd>C</kbd> <kbd>R</kbd> <kbd>D</kbd> <kbd>A</kbd> <kbd>Q</kbd> <kbd>K</kbd>
      · <kbd>B</kbd> pinpoint · <kbd>⌘↵</kbd> generate · <kbd>⌘P</kbd> palette · <kbd>?</kbd> help
    </div>
  {/if}
</div>
