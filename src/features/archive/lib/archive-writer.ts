import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { atomicWriteSync } from '../../../shared/lib/fs-utils.js';

const ARCHIVE_DIR = join(homedir(), '.claude', 'clinsight', 'archive');

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

/** 날짜 문자열(YYYY-MM-DD) 생성 */
function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0];
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

  const session = readArchive(archivePath);
  if (!session) return;

  // 전체 메시지를 JSONL 기준으로 교체 (JSONL이 source of truth)
  session.messages = messages;
  session.model = meta.model !== 'unknown' ? meta.model : session.model;
  session.project = meta.project !== 'unknown' ? meta.project : session.project;
  session.stats.userMessageCount = messages.filter((m) => m.role === 'user').length;

  atomicWriteSync(archivePath, JSON.stringify(session, null, 2));
}

/** 기존 아카이브 파일 찾기 (오늘 또는 최근) */
function findArchivePath(sessionId: string): string | null {
  // 오늘 먼저
  const todayPath = getArchivePath(sessionId);
  if (existsSync(todayPath)) return todayPath;

  // 어제도 확인 (자정 걸치는 세션)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayPath = getArchivePath(sessionId, yesterday);
  if (existsSync(yesterdayPath)) return yesterdayPath;

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

export { ARCHIVE_DIR };
