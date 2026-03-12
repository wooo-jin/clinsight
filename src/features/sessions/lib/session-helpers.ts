import { statSync } from 'fs';
import { join } from 'path';
import { PROJECTS_DIR } from '../../../shared/lib/constants.js';
import { projectPathToDirName } from '../../../entities/session/index.js';
import type { ParsedSession } from '../../../shared/types/session.js';

export const SESSION_LIST_LIMIT = 15;

/** 세션이 활성(연결) 상태인지 확인
 * JSONL이 최근 30분 내 수정됨 = 활성
 */
export function isSessionActive(session: ParsedSession): boolean {
  const dirName = projectPathToDirName(session.project);
  const jsonlPath = join(PROJECTS_DIR, dirName, `${session.sessionId}.jsonl`);
  try {
    const mtime = statSync(jsonlPath).mtime.getTime();
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
    return mtime > thirtyMinAgo;
  } catch {
    return false;
  }
}

export function efficiencyLabel(score: number): string {
  if (score >= 80) return '✓ ' + score;
  if (score >= 50) return '⚠ ' + score;
  return '✗ ' + score;
}
