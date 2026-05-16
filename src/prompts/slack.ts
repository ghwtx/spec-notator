import type { EnrichedAnnotation, DocPayload, SlackTone, SlackGrouping } from "../types";
import { TYPES, TYPE_BY_ID } from "../types";

const EMOJI: Record<string, string> = {
  comment: ":speech_balloon:",
  replace: ":pencil2:",
  delete: ":wastebasket:",
  add: ":heavy_plus_sign:",
  question: ":question:",
  approve: ":white_check_mark:",
};

export interface SlackOpts {
  tone?: SlackTone;
  groupBy?: SlackGrouping;
  includeQuotes?: boolean;
}

export function buildSlack(
  doc: DocPayload,
  annotations: EnrichedAnnotation[],
  opts: SlackOpts = {},
): string {
  const includeQuotes = opts.includeQuotes !== false;
  const groupByType = opts.groupBy === "type";
  const tone = opts.tone || "casual";
  const list = annotations.filter((a) => !a.resolved);
  if (list.length === 0) return "_(no open annotations)_";

  const greet =
    tone === "casual"
      ? `*Quick review of \`${doc.name}\`* — left ${list.length} note${list.length === 1 ? "" : "s"} for you 👇`
      : `*Review of \`${doc.name}\`* — ${list.length} item${list.length === 1 ? "" : "s"} below.`;

  const renderItem = (a: EnrichedAnnotation): string => {
    const t = TYPE_BY_ID[a.type];
    const head = `${EMOJI[a.type]} *${t.label}*${a.blockCrumb ? ` _in ${a.blockCrumb}_` : ""} · _L${a.line || "?"}_`;
    const quote =
      includeQuotes && a.quoted
        ? `> ${a.quoted.length > 140 ? a.quoted.slice(0, 137) + "…" : a.quoted}`
        : "";
    const body =
      a.type === "replace" && a.replacement
        ? `_rewrite as:_  \`${a.replacement}\`${a.note ? `\n${a.note}` : ""}`
        : a.type === "add" && a.replacement
        ? `_insert:_  \`${a.replacement}\`${a.note ? `\n${a.note}` : ""}`
        : a.type === "delete"
        ? `_proposed: remove this_${a.note ? `\n${a.note}` : ""}`
        : a.type === "approve"
        ? a.note || "_lgtm_"
        : a.note || "_(no note)_";
    return [head, quote, body].filter(Boolean).join("\n");
  };

  if (groupByType) {
    const groups: Record<string, EnrichedAnnotation[]> = {};
    list.forEach((a) => {
      (groups[a.type] = groups[a.type] || []).push(a);
    });
    const parts = [greet];
    TYPES.forEach((t) => {
      const g = groups[t.id];
      if (!g) return;
      parts.push(`\n*${t.label}* — ${g.length}\n` + g.map(renderItem).join("\n\n"));
    });
    return parts.join("\n");
  }

  return greet + "\n\n" + list.map(renderItem).join("\n\n");
}
