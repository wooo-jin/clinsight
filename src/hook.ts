#!/usr/bin/env node
/**
 * Clinsight Hook Handler
 * Claude Code hooks에서 호출되는 스크립트
 *
 * 사용법: node dist/hook.js <event-type>
 *   session-start   → 세션 아카이브 초기화
 *   prompt-submit   → 사용자 프롬프트 기록
 *   session-stop    → JSONL 파싱 후 완전한 아카이브 생성
 */
import { mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { initArchive, syncMessages, finalizeArchive } from './features/archive/lib/archive-writer.js';
import { findJsonlPath, jsonlToMessages, extractJsonlMeta } from './features/archive/lib/jsonl-to-archive.js';
import { loadSession } from './entities/session/lib/parser.js';
import { ANALYSIS, getContextWindowSize } from './shared/lib/constants.js';
import type { ParsedSession } from './shared/types/session.js';

const HOOK_ERROR_LOG = join(homedir(), '.claude', 'clinsight', 'hook-errors.log');

interface HookInput {
  session_id?: string;
  sessionId?: string;
  prompt?: string;
  cwd?: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    // TTY(인터랙티브)면 stdin이 오지 않으므로 즉시 빈 문자열 반환
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let data = '';
    let resolved = false;
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      if (!resolved) { resolved = true; resolve(data); }
    });
    process.stdin.on('error', (err) => {
      if (!resolved) { resolved = true; reject(err); }
    });
  });
}

async function main() {
  const event = process.argv[2];
  if (!event) {
    process.exit(1);
  }

  let input: HookInput = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) {
      input = JSON.parse(raw);
    }
  } catch {
    // stdin 파싱 실패 시 빈 객체로 진행
  }

  const sessionId = input.session_id ?? input.sessionId ?? '';
  if (!sessionId) {
    process.exit(0);
  }

  try {
    switch (event) {
      case 'session-start':
        handleSessionStart(sessionId, input);
        break;
      case 'prompt-submit':
        handlePromptSubmit(sessionId, input);
        break;
      case 'session-stop':
        handleSessionStop(sessionId);
        break;
    }
  } catch (err) {
    // 훅은 실패해도 Claude Code에 영향 주지 않도록 조용히 종료
    // 에러 로그 기록
    try {
      mkdirSync(join(homedir(), '.claude', 'clinsight'), { recursive: true });
      const ts = new Date().toISOString();
      const msg = err instanceof Error ? err.message : String(err);
      appendFileSync(HOOK_ERROR_LOG, `[${ts}] event=${event} session=${sessionId} error=${msg}\n`);
    } catch { /* 로깅 실패도 무시 */ }
  }
}

function handleSessionStart(sessionId: string, input: HookInput): void {
  const project = input.cwd ?? 'unknown';
  initArchive(sessionId, project);
}

function handlePromptSubmit(sessionId: string, _input: HookInput): void {
  const jsonlPath = findJsonlPath(sessionId);
  if (!jsonlPath) return;

  // 1. 아카이브 동기화 (JSONL → archive JSON) — JSONL 1회 파싱
  const messages = jsonlToMessages(jsonlPath);
  const meta = extractJsonlMeta(jsonlPath); // 16KB만 읽음 (별도 소량 읽기)
  syncMessages(sessionId, messages, meta);

  // 2. 경고 생성 — loadSession이 JSONL을 다시 파싱하는 것을 방지하기 위해
  //    아카이브 동기화에서 이미 파싱한 meta 정보를 활용
  //    경고에 필요한 핵심 지표만 빠르게 계산
  const session = loadSession(sessionId, jsonlPath);
  if (!session) return;

  const alerts = buildSessionAlertsFromParsed(session);
  if (alerts) {
    const sanitized = alerts
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    process.stdout.write(JSON.stringify({ additionalContext: sanitized }));
  }
}

/** 파싱된 세션에서 경고 메시지 생성 (JSONL 재파싱 없음) */
function buildSessionAlertsFromParsed(session: ParsedSession): string | null {
  const warnings: string[] = [];

  // 1. 컨텍스트 포화도 (모델별 윈도우 크기 기반)
  const contextWindow = getContextWindowSize(session.model);
  const contextWarning = Math.round(contextWindow * 0.75);
  const contextCritical = Math.round(contextWindow * 0.9);
  if (session.peakContextTokens > contextCritical) {
    const pct = Math.round((session.peakContextTokens / contextWindow) * 100);
    warnings.push(`[Clinsight] 컨텍스트 ${pct}% 사용 중 (${Math.round(session.peakContextTokens / 1000)}K/${Math.round(contextWindow / 1000)}K). /compact 실행을 권장합니다.`);
  } else if (session.peakContextTokens > contextWarning) {
    const pct = Math.round((session.peakContextTokens / contextWindow) * 100);
    warnings.push(`[Clinsight] 컨텍스트 ${pct}% 사용 중. 곧 /compact가 필요할 수 있습니다.`);
  }

  // 2. 비용 경고
  if (session.estimatedCostUsd > ANALYSIS.SESSION_COST_CRITICAL) {
    warnings.push(`[Clinsight] 이 세션 비용 $${session.estimatedCostUsd.toFixed(2)}. 작업 범위를 좁히거나 세션을 나누는 것을 권장합니다.`);
  } else if (session.estimatedCostUsd > ANALYSIS.SESSION_COST_WARNING) {
    warnings.push(`[Clinsight] 이 세션 비용 $${session.estimatedCostUsd.toFixed(2)}. 비용이 높아지고 있습니다.`);
  }

  // 3. 되돌림 (삽질) 경고
  if (session.revertCount >= 5) {
    warnings.push(`[Clinsight] 되돌림 ${session.revertCount}회 감지. 요구사항을 명확히 하거나 단계별로 접근하세요.`);
  } else if (session.revertCount >= 3) {
    warnings.push(`[Clinsight] 되돌림 ${session.revertCount}회 감지. 접근 방식을 재검토하는 것이 좋겠습니다.`);
  }

  // 4. 50MB 절단 경고
  if (session.truncated) {
    warnings.push(`[Clinsight] 이 세션의 JSONL이 50MB를 초과하여 일부만 분석되었습니다. 세션을 나누는 것을 권장합니다.`);
  }

  // 5. 세션 길이 경고
  const durationCritical = ANALYSIS.SESSION_DURATION_CRITICAL;
  if (session.durationMinutes > durationCritical) {
    warnings.push(`[Clinsight] 세션 ${session.durationMinutes}분 진행 중. 새 세션으로 분리하는 것을 권장합니다.`);
  } else if (session.durationMinutes > ANALYSIS.SESSION_DURATION_WARNING) {
    warnings.push(`[Clinsight] 세션 ${session.durationMinutes}분 진행 중. 40-50분 단위 세션이 효율적입니다.`);
  }

  if (warnings.length === 0) return null;
  return warnings.join('\n');
}

function handleSessionStop(sessionId: string): void {
  // JSONL에서 완전한 대화 기록 추출
  const jsonlPath = findJsonlPath(sessionId);
  if (!jsonlPath) return;

  const messages = jsonlToMessages(jsonlPath);
  const meta = extractJsonlMeta(jsonlPath);

  // 기존 파서로 통계 데이터 가져오기 (이미 알고 있는 경로 전달로 디렉토리 스캔 생략)
  const parsed = loadSession(sessionId, jsonlPath);

  finalizeArchive(sessionId, {
    project: parsed?.project ?? meta.project,
    startTime: parsed?.startTime ?? new Date(),
    endTime: parsed?.endTime ?? new Date(),
    durationMinutes: parsed?.durationMinutes ?? 0,
    model: parsed?.model ?? meta.model,
    userMessageCount: parsed?.userMessageCount ?? messages.filter((m) => m.role === 'user').length,
    toolUseCount: parsed?.toolUseCount ?? 0,
    filesEdited: parsed?.filesEdited ?? [],
    filesRead: parsed?.filesRead ?? [],
    estimatedCostUsd: parsed?.estimatedCostUsd ?? 0,
    totalInputTokens: parsed?.totalInputTokens ?? 0,
    totalOutputTokens: parsed?.totalOutputTokens ?? 0,
    userPrompts: parsed?.userPrompts ?? [],
    messages,
  });
}

main();
