import { statSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { PROJECTS_DIR } from '../../../shared/lib/constants.js';
import type { ParsedSession } from '../../../shared/types/session.js';

export const SESSION_LIST_LIMIT = 15;

/** 세션이 활성(연결) 상태인지 확인
 * JSONL이 최근 30분 내 수정됨 = 활성
 * projectPathToDirName 역변환 불일치 방지를 위해 전체 디렉토리에서 sessionId로 직접 검색
 */
export function isSessionActive(session: ParsedSession): boolean {
  if (!existsSync(PROJECTS_DIR)) return false;

  try {
    for (const dirName of readdirSync(PROJECTS_DIR)) {
      const jsonlPath = join(PROJECTS_DIR, dirName, `${session.sessionId}.jsonl`);
      try {
        const mtime = statSync(jsonlPath).mtime.getTime();
        const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
        return mtime > thirtyMinAgo;
      } catch {
        continue;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function efficiencyLabel(score: number): string {
  if (score >= 80) return '✓ ' + score;
  if (score >= 50) return '⚠ ' + score;
  return '✗ ' + score;
}
