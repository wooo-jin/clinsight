import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join, basename } from 'path';
import type {
  ParsedSession,
  ProjectMessage,
  ProjectUserMessage,
  ProjectAssistantMessage,
} from '../../../shared/types/session.js';
import {
  calculateCost,
  getPricing,
  extractUserPrompt,
  extractToolUses,
  categorizeTools,
  analyzeInteractionPattern,
  countReverts,
} from './parser-utils.js';
import { CLAUDE_DIR, PROJECTS_DIR, MAX_JSONL_SIZE } from '../../../shared/lib/constants.js';

export function getClaudeDir(): string {
  return CLAUDE_DIR;
}

/** 프로젝트 경로 → 프로젝트 디렉토리명 변환 */
export function projectPathToDirName(projectPath: string): string {
  return projectPath.replace(/^\//, '-').replace(/\//g, '-');
}

/** JSONL에서 첫 user 메시지의 cwd 추출 (하이픈 경로 역변환 불가 → cwd가 유일한 소스) */
function extractCwdFromJsonl(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // 전체 파싱 없이 첫 user 줄에서 cwd만 추출
    for (const line of content.split('\n')) {
      if (!line.includes('"user"')) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'user' && obj.cwd) return obj.cwd;
      } catch { continue; }
    }
  } catch (err) { console.error('[clinsight] extractCwdFromJsonl:', err); }
  return null;
}

/** dirName → project 경로 캐시 (JSONL cwd 기반, 최대 100개) */
const DIR_NAME_CACHE_MAX = 100;
const dirNameCache = new Map<string, string>();

function dirNameToProjectPath(dirName: string, jsonlPaths: string[]): string {
  const cached = dirNameCache.get(dirName);
  if (cached) return cached;

  // 캐시 크기 제한
  if (dirNameCache.size >= DIR_NAME_CACHE_MAX) {
    dirNameCache.clear();
  }

  // 여러 JSONL에서 cwd 추출 시도 (첫 파일에 cwd가 없을 수 있음)
  for (const p of jsonlPaths) {
    const cwd = extractCwdFromJsonl(p);
    if (cwd) {
      dirNameCache.set(dirName, cwd);
      return cwd;
    }
  }

  // fallback: cwd 추출 실패 시 디렉토리명을 그대로 사용
  dirNameCache.set(dirName, dirName);
  return dirName;
}

interface SessionFile {
  sessionId: string;
  project: string;
  filePath: string;
  mtime: Date;
}

/** projects/ 디렉토리에서 모든 세션 파일 수집 */
function listAllSessionFiles(): SessionFile[] {
  if (!existsSync(PROJECTS_DIR)) return [];

  const result: SessionFile[] = [];
  const projectDirs = readdirSync(PROJECTS_DIR);

  for (const dirName of projectDirs) {
    const dirPath = join(PROJECTS_DIR, dirName);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch (err) {
      console.error('[clinsight] stat project dir:', err);
      continue;
    }

    try {
      const files = readdirSync(dirPath).filter((f: string) => f.endsWith('.jsonl'));
      if (files.length === 0) continue;

      // JSONL에서 cwd를 추출하여 프로젝트 경로 결정 (최대 5개 파일 시도)
      const samplePaths = files.slice(0, 5).map((f) => join(dirPath, f));
      const project = dirNameToProjectPath(dirName, samplePaths);

      for (const file of files) {
        const filePath = join(dirPath, file);
        const sessionId = basename(file, '.jsonl');
        try {
          const stat = statSync(filePath);
          result.push({ sessionId, project, filePath, mtime: stat.mtime });
        } catch (err) {
          console.error('[clinsight] stat session file:', err);
          continue;
        }
      }
    } catch (err) {
      console.error('[clinsight] readdir project:', err);
      continue;
    }
  }

  return result;
}

/** 파일 앞부분만 안전하게 읽기 (OOM 방지: 대용량 파일에서 전체 로드 없이 제한 크기만 읽음) */
function readFileSafe(filePath: string, maxSize: number): { content: string; truncated: boolean } {
  let fileSize: number;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    return { content: '', truncated: false };
  }
  if (fileSize <= maxSize) {
    return { content: readFileSync(filePath, 'utf-8'), truncated: false };
  }
  // 대용량 파일: fd 기반으로 앞부분만 읽기 (readFileSync().slice()는 전체를 메모리에 올림)
  const buf = Buffer.alloc(maxSize);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buf, 0, maxSize, 0);
  } finally {
    closeSync(fd);
  }
  // 절단 시 마지막 완전한 줄(\n)까지만 사용 — 불완전한 JSON 라인 방지
  const raw = buf.toString('utf-8');
  const lastNewline = raw.lastIndexOf('\n');
  const content = lastNewline > 0 ? raw.slice(0, lastNewline) : raw;
  return { content, truncated: true };
}

/** JSONL 파싱 */
function parseJsonl(filePath: string): { messages: ProjectMessage[]; truncated: boolean } {
  if (!existsSync(filePath)) return { messages: [], truncated: false };

  const { content: rawContent, truncated } = readFileSafe(filePath, MAX_JSONL_SIZE);
  const lines = rawContent.split('\n').filter(Boolean);
  const messages: ProjectMessage[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as ProjectMessage;
      if (obj.type === 'user' || obj.type === 'assistant') {
        messages.push(obj);
      }
    } catch {
      continue;
    }
  }

  return { messages, truncated };
}
/** 세션 파일에서 ParsedSession 생성 */
function loadSessionFromFile(sf: SessionFile): ParsedSession | null {
  const { messages, truncated } = parseJsonl(sf.filePath);
  const userMsgs = messages.filter((m): m is ProjectUserMessage => m.type === 'user');
  const assistantMsgs = messages.filter((m): m is ProjectAssistantMessage => m.type === 'assistant');

  if (userMsgs.length === 0 && assistantMsgs.length === 0) return null;

  // 타임스탬프
  const allTimestamps = [...userMsgs, ...assistantMsgs]
    .map((m) => new Date(m.timestamp).getTime())
    .filter((t) => !isNaN(t));

  if (allTimestamps.length === 0) return null;

  let minTs = allTimestamps[0];
  let maxTs = allTimestamps[0];
  for (let i = 1; i < allTimestamps.length; i++) {
    if (allTimestamps[i] < minTs) minTs = allTimestamps[i];
    if (allTimestamps[i] > maxTs) maxTs = allTimestamps[i];
  }
  const startTime = new Date(minTs);
  const endTime = new Date(maxTs);
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 1000 / 60);

  // 도구 사용 분석
  const toolBreakdown: Record<string, number> = {};
  const filesReadSet = new Set<string>();
  const filesEditedSet = new Set<string>();
  const editCounts: Record<string, number> = {};
  const editOps: { file: string; oldStr: string; newStr: string }[] = [];
  const agentTypes: Record<string, number> = {};

  for (const msg of assistantMsgs) {
    const tools = extractToolUses(msg);
    for (const tool of tools) {
      const normalizedName = tool.name.toLowerCase();
      toolBreakdown[normalizedName] = (toolBreakdown[normalizedName] ?? 0) + 1;

      // Agent 타입 추적
      if (normalizedName === 'agent' || normalizedName === 'sendmessage') {
        const subType = (tool.input.subagent_type as string) ?? 'unknown';
        agentTypes[subType] = (agentTypes[subType] ?? 0) + 1;
      }

      const filePath = tool.input.file_path as string | undefined;
      if (!filePath) continue;

      if (normalizedName === 'read') {
        filesReadSet.add(filePath);
      }

      if (normalizedName === 'edit' || normalizedName === 'write') {
        filesEditedSet.add(filePath);
        editCounts[filePath] = (editCounts[filePath] ?? 0) + 1;

        if (normalizedName === 'edit') {
          const oldStr = (tool.input.old_string as string) ?? '';
          const newStr = (tool.input.new_string as string) ?? '';
          editOps.push({ file: filePath, oldStr, newStr });
        }
      }
    }
  }

  const filesRead = Array.from(filesReadSet);
  const filesEdited = Array.from(filesEditedSet);

  // 되돌림 감지는 전체 editOps로 수행 (정확한 분석)
  const revertCount = countReverts(editOps);

  // 토큰 사용량
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalCost = 0;
  let peakContextTokens = 0;
  let model = 'unknown';

  for (const msg of assistantMsgs) {
    const usage = msg.message?.usage;
    const msgModel = msg.message?.model ?? 'unknown';
    if (model === 'unknown') model = msgModel;

    if (usage) {
      totalInputTokens += usage.input_tokens ?? 0;
      totalOutputTokens += usage.output_tokens ?? 0;
      totalCacheReadTokens += usage.cache_read_input_tokens ?? 0;
      totalCacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
      totalCost += calculateCost(usage, msgModel);

      // 단일 메시지 기준 컨텍스트 크기 = 전체 프롬프트 토큰
      const msgContext = (usage.input_tokens ?? 0)
        + (usage.cache_read_input_tokens ?? 0)
        + (usage.cache_creation_input_tokens ?? 0);
      if (msgContext > peakContextTokens) peakContextTokens = msgContext;
    }
  }

  // 사용자 프롬프트
  const userPrompts = userMsgs
    .map(extractUserPrompt)
    .filter((p) => p.length > 0 && !p.startsWith('/'));

  const interactionPattern = analyzeInteractionPattern(userPrompts);
  const totalToolUses = Object.values(toolBreakdown).reduce((a, b) => a + b, 0);
  const featureUsage = categorizeTools(toolBreakdown);

  return {
    sessionId: sf.sessionId,
    project: sf.project,
    startTime,
    endTime,
    durationMinutes,
    userMessageCount: userMsgs.length,
    toolUseCount: totalToolUses,
    toolBreakdown,
    filesRead,
    filesEdited,
    repeatedEdits: Object.fromEntries(
      Object.entries(editCounts).filter(([, count]) => count > 1),
    ),
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    model,
    estimatedCostUsd: Math.round(totalCost * 10000) / 10000,
    costPricing: getPricing(model),
    peakContextTokens,
    userPrompts,
    featureUsage,
    revertCount,
    interactionPattern,
    agentTypes,
    editOps: editOps.slice(0, 20), // compound 프롬프트용 샘플 (revertCount는 전체 editOps로 계산 완료)
    truncated,
  };
}

/** 최근 N개 세션 로드 */
export function loadRecentSessions(count: number = 50): ParsedSession[] {
  const allFiles = listAllSessionFiles();

  const sorted = allFiles
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, count);

  const sessions: ParsedSession[] = [];
  for (const sf of sorted) {
    const session = loadSessionFromFile(sf);
    if (session) sessions.push(session);
  }

  return sessions.sort(
    (a, b) => b.startTime.getTime() - a.startTime.getTime(),
  );
}

export function loadSession(sessionId: string, knownJsonlPath?: string): ParsedSession | null {
  // knownJsonlPath가 제공되면 디렉토리 스캔 생략 (hook에서 이미 경로를 알고 있는 경우)
  if (knownJsonlPath && existsSync(knownJsonlPath)) {
    const stat = statSync(knownJsonlPath);
    const dirName = knownJsonlPath.split('/').slice(-2, -1)[0] ?? '';
    const project = dirNameToProjectPath(dirName, [knownJsonlPath]);
    const sf: SessionFile = { sessionId, project, filePath: knownJsonlPath, mtime: stat.mtime };
    return loadSessionFromFile(sf);
  }

  // 전체 디렉토리 스캔 대신 직접 경로 탐색 (Hook에서 매 프롬프트마다 호출되므로 성능 중요)
  if (!existsSync(PROJECTS_DIR)) return null;

  try {
    const projectDirs = readdirSync(PROJECTS_DIR);
    for (const dirName of projectDirs) {
      const filePath = join(PROJECTS_DIR, dirName, `${sessionId}.jsonl`);
      if (!existsSync(filePath)) continue;

      const stat = statSync(filePath);
      const samplePaths = [filePath];
      const project = dirNameToProjectPath(dirName, samplePaths);

      const sf: SessionFile = { sessionId, project, filePath, mtime: stat.mtime };
      return loadSessionFromFile(sf);
    }
  } catch (err) { console.error('[clinsight] loadSession scan:', err); }

  return null;
}

export function listSessionIds(): string[] {
  return listAllSessionFiles().map((f) => f.sessionId);
}
