import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { CompoundResult, AppliedCompoundItem } from '../../../shared/types/session.js';
import { COMPOUND_DIR } from '../../../shared/lib/constants.js';

export interface ListItem {
  type: AppliedCompoundItem['type'];
  text: string;
  isHeader?: boolean;
  label?: string;
}

export function loadCompoundResults(): CompoundResult[] {
  if (!existsSync(COMPOUND_DIR)) return [];
  try {
    const dataFile = join(COMPOUND_DIR, 'history.json');
    if (!existsSync(dataFile)) return [];
    const data = JSON.parse(readFileSync(dataFile, 'utf-8'));
    return Array.isArray(data) ? (data as CompoundResult[]) : [];
  } catch {
    return [];
  }
}

export function saveCompoundResults(results: CompoundResult[]): void {
  mkdirSync(COMPOUND_DIR, { recursive: true });
  const dataFile = join(COMPOUND_DIR, 'history.json');
  writeFileSync(dataFile, JSON.stringify(results, null, 2));
}

/** 적용 가능한 규칙 (CLAUDE.md에 추가할 항목) */
export function buildActionItems(result: CompoundResult | undefined): ListItem[] {
  if (!result) return [];
  const items: ListItem[] = [];
  if (result.preventionRules && result.preventionRules.length > 0) {
    items.push({ type: 'preventionRule', text: '', isHeader: true, label: '🛡️ 규칙' });
    for (const r of result.preventionRules) {
      items.push({ type: 'preventionRule', text: `[${r.category}] ${r.rule}` });
    }
  }
  if (result.conventions.length > 0) {
    items.push({ type: 'convention', text: '', isHeader: true, label: '📐 컨벤션' });
    for (const c of result.conventions) items.push({ type: 'convention', text: c });
  }
  return items;
}

/** 참고용 인사이트 (읽기 전용) */
export function buildInsightItems(result: CompoundResult | undefined): ListItem[] {
  if (!result) return [];
  const items: ListItem[] = [];
  if (result.patterns.length > 0) {
    items.push({ type: 'pattern', text: '', isHeader: true, label: '🔄 패턴' });
    for (const p of result.patterns) items.push({ type: 'pattern', text: p });
  }
  if (result.solutions.length > 0) {
    items.push({ type: 'solution', text: '', isHeader: true, label: '💡 솔루션' });
    for (const s of result.solutions) items.push({ type: 'solution', text: s });
  }
  return items;
}

/** 전체 항목 (하위 호환용) */
export function buildItemList(result: CompoundResult | undefined): ListItem[] {
  return [...buildActionItems(result), ...buildInsightItems(result)];
}
