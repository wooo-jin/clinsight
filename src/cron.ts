#!/usr/bin/env node
/**
 * 매일 밤 실행되는 컴파운드 크론잡 스크립트
 * 사용법: npx tsx src/cron.ts
 * 크론탭: 0 23 * * * cd /path/to/clinsight && npx tsx src/cron.ts
 */
import { mkdirSync, existsSync, unlinkSync, readFileSync, writeFileSync, openSync, closeSync, constants as fsConstants, statSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadRecentSessions } from './entities/session/lib/parser.js';
import { analyzeSession } from './entities/session/lib/analyzer.js';
import { runCompound } from './entities/session/lib/compound.js';
import { atomicWriteSync } from './shared/lib/fs-utils.js';
import { cleanupOldArchives, getArchiveSize } from './features/archive/lib/archive-writer.js';
import { loadConfig } from './shared/lib/config.js';
import type { DailySummary, CompoundResult } from './shared/types/session.js';

const DATA_DIR = join(homedir(), '.claude', 'clinsight');
const COMPOUNDS_DIR = join(DATA_DIR, 'compounds');
const SUMMARIES_DIR = join(DATA_DIR, 'summaries');
const LOCK_FILE = join(DATA_DIR, '.cron.lock');

function ensureDirs() {
  mkdirSync(COMPOUNDS_DIR, { recursive: true });
  mkdirSync(SUMMARIES_DIR, { recursive: true });
}

/** 로컬 타임존 기준 날짜 문자열 (YYYY-MM-DD) */
function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const CRON_LOG_FILE = join(DATA_DIR, 'cron.log');
const CRON_LOG_MAX_SIZE = 1 * 1024 * 1024; // 1MB

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

/** 크론 로그 로테이션 (1MB 초과 시 .old로 rename) */
function rotateCronLog(): void {
  try {
    if (!existsSync(CRON_LOG_FILE)) return;
    const size = statSync(CRON_LOG_FILE).size;
    if (size > CRON_LOG_MAX_SIZE) {
      renameSync(CRON_LOG_FILE, CRON_LOG_FILE + '.old');
    }
  } catch (err) { console.error('[clinsight] cron log rotation:', err); }
}

/** 중복 실행 방지용 lock (O_EXCL 원자적 생성) */
function acquireLock(): boolean {
  // 1차: O_EXCL로 원자적 생성 시도
  try {
    const fd = openSync(LOCK_FILE, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL);
    writeFileSync(fd, String(Date.now()));
    closeSync(fd);
    return true;
  } catch {
    // 파일이 이미 존재 → stale 여부 확인
  }

  // stale lock 처리 (10분 초과 시 rename으로 원자적 교체하여 TOCTOU 방지)
  try {
    const lockTime = parseInt(readFileSync(LOCK_FILE, 'utf-8'), 10);
    if (Date.now() - lockTime < 10 * 60 * 1000) {
      return false; // 아직 유효한 lock
    }
  } catch {
    // 읽기 실패 → stale로 간주
  }

  // stale lock 처리: 새 lock을 임시 파일로 생성 후 rename으로 원자적 교체
  // rename은 POSIX에서 원자적이므로 TOCTOU 방지
  const myToken = `${process.pid}.${Date.now()}`;
  const tmpLock = LOCK_FILE + `.${myToken}`;
  try {
    writeFileSync(tmpLock, myToken);
    renameSync(tmpLock, LOCK_FILE);
    // rename 후 lock 파일 내용이 내 토큰인지 확인 (동시 rename 대비)
    const content = readFileSync(LOCK_FILE, 'utf-8');
    if (content === myToken) {
      return true;
    }
  } catch {
    // rename 실패
  }
  try { unlinkSync(tmpLock); } catch { /* cleanup */ }
  return false;
}

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch (err) {
    console.error('[clinsight] releaseLock:', err);
  }
}

/** 설정된 보관 기간에 따라 오래된 컴파운드 결과 정리 */
function cleanupOldCompounds(): { removedCount: number; skipped: boolean } {
  const config = loadConfig();
  if (config.compoundRetentionDays <= 0) {
    return { removedCount: 0, skipped: true };
  }

  const historyFile = join(COMPOUNDS_DIR, 'history.json');
  if (!existsSync(historyFile)) return { removedCount: 0, skipped: false };

  try {
    const data = JSON.parse(readFileSync(historyFile, 'utf-8')) as CompoundResult[];
    if (!Array.isArray(data)) return { removedCount: 0, skipped: false };

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.compoundRetentionDays);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const filtered = data.filter((r) => r.date >= cutoffStr);
    const removedCount = data.length - filtered.length;

    if (removedCount > 0) {
      atomicWriteSync(historyFile, JSON.stringify(filtered, null, 2));
    }

    return { removedCount, skipped: false };
  } catch (err) {
    console.error('[clinsight] cleanupOldCompounds:', err);
    return { removedCount: 0, skipped: false };
  }
}

async function main() {
  ensureDirs();
  rotateCronLog();

  if (!acquireLock()) {
    log('다른 크론잡이 실행 중입니다. 종료합니다.');
    return;
  }

  try {
    const dateStr = today();
    log('=== Claude Compound HUD 야간 크론잡 시작 ===');

    // 1. 오늘 세션 로드 (mtime 필터로 불필요한 파싱 최소화)
    log('세션 데이터 로드 중...');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // 오늘 수정된 파일만 대상 (300개 전체 스캔 대신)
    const sessions = loadRecentSessions(100);
    const todaySessions = sessions.filter((s) => s.startTime >= todayStart);
    log(`오늘 세션: ${todaySessions.length}개 / 로드: ${sessions.length}개`);

    if (todaySessions.length === 0) {
      log('오늘 세션이 없습니다. 종료합니다.');
      return; // finally에서 releaseLock() 호출
    }

    // 2. 분석
    log('세션 분석 중...');
    const analyses = todaySessions.map((s) => analyzeSession(s));
    const avgEfficiency = Math.round(
      analyses.reduce((sum, a) => sum + a.efficiencyScore, 0) / analyses.length,
    );

    // 3. 일별 요약 저장 (atomic write)
    const summary: DailySummary = {
      date: dateStr,
      sessionCount: todaySessions.length,
      totalInputTokens: todaySessions.reduce((sum, s) => sum + s.totalInputTokens, 0),
      totalOutputTokens: todaySessions.reduce((sum, s) => sum + s.totalOutputTokens, 0),
      totalCostUsd: todaySessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0),
      avgEfficiency,
      topTools: Object.entries(
        todaySessions.reduce<Record<string, number>>((acc, s) => {
          for (const [tool, count] of Object.entries(s.toolBreakdown)) {
            acc[tool] = (acc[tool] ?? 0) + count;
          }
          return acc;
        }, {}),
      )
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5) as [string, number][],
      suggestions: analyses.flatMap((a) => a.suggestions).slice(0, 10),
    };

    const summaryFile = join(SUMMARIES_DIR, `${dateStr}.json`);
    atomicWriteSync(summaryFile, JSON.stringify(summary, null, 2));
    log(`일별 요약 저장: ${summaryFile}`);

    // 4. 컴파운드 실행 (Claude Sonnet) — runCompound 내부에서 history.json에 자동 저장
    log('컴파운드 분석 실행 중 (Claude Sonnet)...');
    const compoundResult = runCompound(todaySessions);
    log(`컴파운드 결과: 패턴 ${compoundResult.patterns.length}개, 솔루션 ${compoundResult.solutions.length}개`);

    // 6. 결과 출력
    log('=== 결과 요약 ===');
    log(`세션 수: ${todaySessions.length}`);
    log(`평균 효율: ${avgEfficiency}/100`);
    log(`총 비용: $${summary.totalCostUsd.toFixed(2)}`);
    log(`패턴: ${compoundResult.patterns.length}개`);
    log(`솔루션: ${compoundResult.solutions.length}개`);
    log(`컨벤션: ${compoundResult.conventions.length}개`);

    if (compoundResult.patterns.length > 0) {
      log('발견된 패턴:');
      compoundResult.patterns.forEach((p, i) => log(`  ${i + 1}. ${p}`));
    }

    // 5. 아카이브 용량 보고 + 정리
    const archiveInfo = getArchiveSize();
    const sizeMB = (archiveInfo.totalBytes / (1024 * 1024)).toFixed(1);
    log(`아카이브 현황: ${archiveInfo.sessionCount}개 세션 / ${archiveInfo.dayCount}일 / ${sizeMB}MB`);

    const cleanup = cleanupOldArchives();
    if (cleanup.skipped) {
      log('아카이브 보관: 무제한 (정리 건너뜀)');
    } else if (cleanup.removedDirs.length > 0) {
      log(`오래된 아카이브 ${cleanup.removedDirs.length}개 디렉토리 정리 완료`);
    } else {
      log('정리할 오래된 아카이브 없음');
    }

    // 7. 컴파운드 히스토리 정리 (compoundRetentionDays 기반)
    const compoundCleanup = cleanupOldCompounds();
    if (compoundCleanup.skipped) {
      log('컴파운드 보관: 무제한 (정리 건너뜀)');
    } else if (compoundCleanup.removedCount > 0) {
      log(`오래된 컴파운드 결과 ${compoundCleanup.removedCount}개 정리 완료`);
    } else {
      log('정리할 오래된 컴파운드 결과 없음');
    }

    log('=== 크론잡 완료 ===');
  } finally {
    releaseLock();
  }
}

main().catch((err) => {
  // finally에서 releaseLock()이 이미 호출되므로 여기서는 호출하지 않음
  console.error('크론잡 실행 실패:', err);
  process.exit(1);
});
