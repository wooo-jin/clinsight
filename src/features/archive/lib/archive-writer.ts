import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { atomicWriteSync, lockFileSync } from '../../../shared/lib/fs-utils.js';
import { loadConfig } from '../../../shared/lib/config.js';

export const ARCHIVE_DIR = join(homedir(), '.claude', 'clinsight', 'archive');

export interface ToolResult {
  name: string;
  input?: Record<string, unknown>;
  output?: string;
}

export interface ArchivedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolUses?: string[];
  toolResults?: ToolResult[];
}

export interface ArchivedSession {
  sessionId: string;
  project: string;
  startedAt: string;
  endedAt: string | null;
  status: 'active' | 'completed';
  durationMinutes: number;
  model: string;
  /** 세션 내용 한 줄 요약 */
  summary?: string;
  messages: ArchivedMessage[];
  stats: {
    userMessageCount: number;
    toolUseCount: number;
    filesEdited: string[];
    filesRead: string[];
    estimatedCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
}

/** 날짜 문자열(YYYY-MM-DD) 생성 — 로컬 타임존 기준 */
function toDateStr(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 아카이브 파일 경로 */
export function getArchivePath(sessionId: string, date?: Date): string {
  const dateStr = toDateStr(date ?? new Date());
  return join(ARCHIVE_DIR, dateStr, `${sessionId}.json`);
}

/** 아카이브 디렉토리 확인 및 생성 */
function ensureArchiveDir(date?: Date): string {
  const dateStr = toDateStr(date ?? new Date());
  const dir = join(ARCHIVE_DIR, dateStr);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 세션 시작 기록 */
export function initArchive(sessionId: string, project: string): void {
  ensureArchiveDir();
  const archivePath = getArchivePath(sessionId);

  const session: ArchivedSession = {
    sessionId,
    project,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'active',
    durationMinutes: 0,
    model: 'unknown',
    messages: [],
    stats: {
      userMessageCount: 0,
      toolUseCount: 0,
      filesEdited: [],
      filesRead: [],
      estimatedCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    },
  };

  atomicWriteSync(archivePath, JSON.stringify(session, null, 2));
}

/** JSONL에서 읽은 전체 대화를 아카이브에 동기화 (매 프롬프트마다 호출) */
export function syncMessages(
  sessionId: string,
  messages: ArchivedMessage[],
  meta: { project: string; model: string },
): void {
  let archivePath = findArchivePath(sessionId);
  if (!archivePath) {
    // SessionStart hook이 안 떴을 경우 여기서 생성
    ensureArchiveDir();
    archivePath = getArchivePath(sessionId);
    initArchive(sessionId, meta.project);
  }

  // read-modify-write 파일 락으로 동시 접근 방지
  const lockPath = archivePath + '.lock';
  try {
    lockFileSync(lockPath, () => {
      const session = readArchive(archivePath!);
      if (!session) return;

      // 전체 메시지를 JSONL 기준으로 교체 (JSONL이 source of truth)
      session.messages = messages;
      session.model = meta.model !== 'unknown' ? meta.model : session.model;
      session.project = meta.project !== 'unknown' ? meta.project : session.project;
      session.stats.userMessageCount = messages.filter((m) => m.role === 'user').length;

      // 사용자 프롬프트 기반 요약 업데이트
      const userPrompts = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content);
      session.summary = generateSessionSummary(userPrompts, []);

      atomicWriteSync(archivePath!, JSON.stringify(session, null, 2));
    });
  } catch (err) {
    // lock 획득 실패 시 다음 프롬프트에서 재시도 (데이터 무결성 우선)
    console.error('[clinsight] syncMessages lock failed, skipping this sync:', err);
  }
}

/** 기존 아카이브 파일 찾기 (오늘부터 최대 7일 전까지 확인하여 중복 방지) */
function findArchivePath(sessionId: string): string | null {
  for (let daysAgo = 0; daysAgo <= 7; daysAgo++) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const path = getArchivePath(sessionId, date);
    if (existsSync(path)) return path;
  }
  return null;
}

/** 아카이브 파일 읽기 */
function readArchive(path: string): ArchivedSession | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ArchivedSession;
  } catch {
    return null;
  }
}

/** ParsedSession으로 아카이브 완성 (세션 종료 시) */
export function finalizeArchive(
  sessionId: string,
  parsed: {
    project: string;
    startTime: Date;
    endTime: Date;
    durationMinutes: number;
    model: string;
    userMessageCount: number;
    toolUseCount: number;
    filesEdited: string[];
    filesRead: string[];
    estimatedCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    userPrompts: string[];
    messages: ArchivedMessage[];
  },
): void {
  // 기존 파일이 있으면 그 날짜 디렉토리에, 없으면 시작일 기준
  let archivePath = findArchivePath(sessionId);
  if (!archivePath) {
    ensureArchiveDir(parsed.startTime);
    archivePath = getArchivePath(sessionId, parsed.startTime);
  }

  const session: ArchivedSession = {
    sessionId,
    project: parsed.project,
    startedAt: parsed.startTime.toISOString(),
    endedAt: parsed.endTime.toISOString(),
    status: 'completed',
    durationMinutes: parsed.durationMinutes,
    model: parsed.model,
    summary: generateSessionSummary(parsed.userPrompts, parsed.filesEdited),
    messages: parsed.messages,
    stats: {
      userMessageCount: parsed.userMessageCount,
      toolUseCount: parsed.toolUseCount,
      filesEdited: parsed.filesEdited,
      filesRead: parsed.filesRead,
      estimatedCostUsd: parsed.estimatedCostUsd,
      totalInputTokens: parsed.totalInputTokens,
      totalOutputTokens: parsed.totalOutputTokens,
    },
  };

  atomicWriteSync(archivePath, JSON.stringify(session, null, 2));
}

/** 설정된 보관 기간에 따라 오래된 아카이브 정리 */
export function cleanupOldArchives(): { removedDirs: string[]; skipped: boolean } {
  const config = loadConfig();
  if (config.archiveRetentionDays <= 0) {
    return { removedDirs: [], skipped: true };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.archiveRetentionDays);
  const cutoffStr = toDateStr(cutoff);
  const removedDirs: string[] = [];

  if (!existsSync(ARCHIVE_DIR)) return { removedDirs, skipped: false };

  for (const dirName of readdirSync(ARCHIVE_DIR)) {
    // YYYY-MM-DD 형식인 디렉토리만 대상
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dirName)) continue;
    if (dirName < cutoffStr) {
      try {
        rmSync(join(ARCHIVE_DIR, dirName), { recursive: true, force: true });
        removedDirs.push(dirName);
      } catch { /* 삭제 실패는 무시 */ }
    }
  }

  return { removedDirs, skipped: false };
}

/** 아카이브 전체 용량 계산 (bytes) */
export function getArchiveSize(): { totalBytes: number; sessionCount: number; dayCount: number } {
  if (!existsSync(ARCHIVE_DIR)) return { totalBytes: 0, sessionCount: 0, dayCount: 0 };

  let totalBytes = 0;
  let sessionCount = 0;
  let dayCount = 0;

  for (const dirName of readdirSync(ARCHIVE_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dirName)) continue;
    const dirPath = join(ARCHIVE_DIR, dirName);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch { continue; }

    dayCount++;
    for (const fileName of readdirSync(dirPath)) {
      if (!fileName.endsWith('.json')) continue;
      try {
        totalBytes += statSync(join(dirPath, fileName)).size;
        sessionCount++;
      } catch { continue; }
    }
  }

  return { totalBytes, sessionCount, dayCount };
}

/**
 * 사용자 프롬프트와 편집 파일 목록으로 세션 한 줄 요약 생성
 * - 첫 번째 의미 있는 프롬프트를 기반으로 요약
 * - 편집 파일이 있으면 파일 수 부기
 */
export function generateSessionSummary(
  userPrompts: string[],
  filesEdited: string[],
): string {
  // 의미 있는 첫 프롬프트 찾기 (너무 짧은 것 건너뛰기)
  const meaningful = userPrompts.find((p) => p.replace(/\s/g, '').length > 5)
    ?? userPrompts[0]
    ?? '';

  if (!meaningful) return '';

  // XML/HTML 태그 제거, 개행/탭 → 공백, 연속 공백 제거
  let summary = meaningful
    .replace(/<[^>]+>/g, '')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 최대 80자로 제한
  const maxLen = 80;
  if (summary.length > maxLen) {
    summary = summary.slice(0, maxLen - 1) + '…';
  }

  // 편집 파일이 있으면 부기
  if (filesEdited.length > 0) {
    summary += ` [${filesEdited.length}개 파일 수정]`;
  }

  return summary;
}

