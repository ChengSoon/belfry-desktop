export type QuickOpenItemKind = "session" | "project" | "action";
export type QuickOpenIcon = "terminal" | "folder" | "settings" | "history" | "gauge" | "sidebar" | "keyboard" | "composer" | "file-search" | "list-checks" | "library";

export interface QuickOpenItem {
  id: string;
  kind: QuickOpenItemKind;
  title: string;
  subtitle: string;
  keywords?: string[];
  disabled?: boolean;
  icon?: QuickOpenIcon;
  /** 由宿主动作消费的稳定值（会话 id 或项目路径），搜索层不解释它。 */
  value?: string;
}

export interface QuickOpenMatch {
  item: QuickOpenItem;
  score: number;
}

/**
 * 对 Quick Open 条目做轻量模糊搜索。
 * 每个空格分开的词都必须命中；标题优先于副标题和关键词，原始顺序作为最终稳定排序。
 */
export function searchQuickOpen(
  items: readonly QuickOpenItem[],
  query: string,
  limit = 50,
): QuickOpenMatch[] {
  const terms = normalize(query).split(/\s+/u).filter(Boolean);
  return items
    .map((item, order) => {
      const score = scoreItem(item, terms);
      return score === null ? null : { item, score: score + (items.length - order) / 1000 };
    })
    .filter((match): match is QuickOpenMatch => match !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(0, limit));
}

function scoreItem(item: QuickOpenItem, terms: string[]) {
  if (item.disabled) return null;
  if (terms.length === 0) return kindWeight(item.kind);

  const fields = [item.title, item.subtitle, ...(item.keywords ?? [])].map(normalize);
  let score = kindWeight(item.kind);
  for (const term of terms) {
    let best: number | null = null;
    for (const [index, field] of fields.entries()) {
      const match = scoreTerm(field, term);
      if (match === null) continue;
      const fieldWeight = index === 0 ? 100 : index === 1 ? 35 : 20;
      best = Math.max(best ?? 0, match + fieldWeight);
    }
    if (best === null) return null;
    score += best;
  }
  return score;
}

function scoreTerm(field: string, term: string) {
  if (field === term) return 900;
  if (field.startsWith(term)) return 720 - Math.min(field.length - term.length, 80);
  const wordStart = field.indexOf(` ${term}`);
  if (wordStart >= 0) return 620 - Math.min(wordStart, 80);
  const positions = findSubsequence(field, term);
  if (!positions) return null;
  const span = positions[positions.length - 1] - positions[0] + 1;
  return 420 - Math.min(span - term.length, 120) - Math.min(positions[0], 80) / 4;
}

function findSubsequence(field: string, term: string) {
  if (!term) return [];
  const positions: number[] = [];
  let cursor = 0;
  for (const character of term) {
    const found = field.indexOf(character, cursor);
    if (found < 0) return null;
    positions.push(found);
    cursor = found + character.length;
  }
  return positions;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function kindWeight(kind: QuickOpenItemKind) {
  return kind === "session" ? 30 : kind === "project" ? 20 : 10;
}
