import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '../../../shared/lib/fs-utils.js';
import { COMPOUND_DIR } from '../../../shared/lib/constants.js';
import type { AppliedCompoundItem } from '../../../shared/types/session.js';

const APPLIED_FILE = join(COMPOUND_DIR, 'applied.json');

export function loadAppliedItems(): AppliedCompoundItem[] {
  if (!existsSync(APPLIED_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(APPLIED_FILE, 'utf-8'));
    return Array.isArray(data) ? (data as AppliedCompoundItem[]) : [];
  } catch {
    return [];
  }
}

export function saveAppliedItems(items: AppliedCompoundItem[]): void {
  mkdirSync(COMPOUND_DIR, { recursive: true });
  atomicWriteSync(APPLIED_FILE, JSON.stringify(items, null, 2));
}

/** 특정 항목이 이미 처리되었는지 확인 */
export function findAppliedItem(
  items: AppliedCompoundItem[],
  type: AppliedCompoundItem['type'],
  text: string,
): AppliedCompoundItem | undefined {
  return items.find((i) => i.type === type && i.text.trim().toLowerCase() === text.trim().toLowerCase());
}
