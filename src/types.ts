export type AnnotationType =
  | "comment"
  | "replace"
  | "delete"
  | "add"
  | "question"
  | "approve";

export interface Annotation {
  id: string;
  blockId: string;             // primary anchor block (first block, for pinpoint)
  blockIds?: string[];         // pinpoint mode: full list of blocks (undefined = text-range annotation)
  start: number;               // ignored when blockIds present (whole blocks)
  end: number;                 // ignored when blockIds present
  quoted: string;
  type: AnnotationType;
  note: string;
  replacement: string;
  resolved: boolean;
  createdAt: number;
  line: number;
  justCreated?: boolean;
}

export interface EnrichedAnnotation extends Annotation {
  blockOrder: number;
  blockCrumb: string;
}

export interface MdBlockHeading { id: string; kind: "heading"; level: number; text: string; slug: string; line: number; }
export interface MdBlockParagraph { id: string; kind: "paragraph"; text: string; line: number; }
export interface MdBlockBlockquote { id: string; kind: "blockquote"; text: string; line: number; }
export interface MdBlockHr { id: string; kind: "hr"; line: number; }
export interface MdBlockCode { id: string; kind: "code"; lang: string; text: string; line: number; }
export interface MdBlockList { id: string; kind: "list"; ordered: boolean; items: { text: string }[]; line: number; }
export interface MdBlockTable { id: string; kind: "table"; header: string[]; rows: string[][]; line: number; }

export type MdBlock =
  | MdBlockHeading
  | MdBlockParagraph
  | MdBlockBlockquote
  | MdBlockHr
  | MdBlockCode
  | MdBlockList
  | MdBlockTable;

export interface BlockMeta {
  order: number;
  crumb: string;
  sectionSlug: string | null;
  line: number;
  kind: MdBlock["kind"];
}

export interface DocPayload {
  name: string;
  content: string;
  path?: string;
  hash?: string;
}

export type AgentFormat = "xml" | "markdown";
export type AgentVariant = "structured" | "patch" | "task";
export type SlackTone = "casual" | "neutral";
export type SlackGrouping = "order" | "type";

export interface TypeMeta {
  id: AnnotationType;
  label: string;
  hint: string;
  shortcut: string;
}

export const TYPES: TypeMeta[] = [
  { id: "comment",  label: "Comment",  hint: "Add a note",            shortcut: "C" },
  { id: "replace",  label: "Replace",  hint: "Suggest a rewrite",     shortcut: "R" },
  { id: "delete",   label: "Delete",   hint: "Mark for removal",      shortcut: "D" },
  { id: "add",      label: "Add",      hint: "Insert something new",  shortcut: "A" },
  { id: "question", label: "Question", hint: "Ask for clarification", shortcut: "Q" },
  { id: "approve",  label: "Approve",  hint: "Looks good",            shortcut: "K" },
];

export const TYPE_BY_ID: Record<AnnotationType, TypeMeta> = Object.fromEntries(
  TYPES.map((t) => [t.id, t]),
) as Record<AnnotationType, TypeMeta>;
