import { execSync } from 'child_process';
import { readdirSync, statSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { PROJECTS_DIR } from '../../../shared/lib/constants.js';

const IS_WINDOWS = process.platform === 'win32';

export interface ZombieInfo {
  /** 좀비 claude 프로세스 목록 (PID, 실행 시간, 상태) */
  processes: ZombieProcess[];
  /** 고아 세션 디렉토리 (프로세스 없이 남은 디렉토리) */
  orphanDirs: OrphanDir[];
}

export interface ZombieProcess {
  pid: number;
  elapsed: string;
  command: string;
  tty: string;
  /** 프로세스 상태 (ps stat 컬럼) */
  stat: string;
}

export interface OrphanDir {
  projectDir: string;
  sessionId: string;
  fullPath: string;
}

/** ps etime 문자열(예: "1-02:03:04", "02:03:04", "03:04")을 시간 단위로 변환 */
export function parseElapsedToHours(elapsed: string): number {
  try {
    const dayMatch = elapsed.match(/^(\d+)-(.+)$/);
    let days = 0;
    let rest = elapsed;
    if (dayMatch) {
      days = parseInt(dayMatch[1], 10);
      rest = dayMatch[2];
    }
    const parts = rest.split(':').map((s) => parseInt(s, 10));
    if (parts.length === 3) return days * 24 + parts[0] + parts[1] / 60;
    if (parts.length === 2) return days * 24 + parts[0] / 60;
    return days * 24;
  } catch {
    return 0;
  }
}

/** Claude 프로세스 매칭 정규식 — 두 함수에서 동일하게 사용 */
const CLAUDE_CMD_PATTERN = /(?:^|\/)claude(?:\s|$)|(?:^|\/)claude-code(?:\s|$)/i;

/**
 * 모든 Claude 프로세스를 단일 ps 호출로 수집 (Unix)
 * command 컬럼 기반으로 통일하여 getActivePids/getAllClaudeProcesses 불일치 해결
 */
interface ProcessEntry {
  pid: number;
  ppid: number;
  elapsed: string;
  tty: string;
  stat: string;
  command: string;
}

function collectAllClaudeProcessesUnix(): ProcessEntry[] {
  try {
    const out = execSync(
      'ps -eo pid,ppid,etime,tty,stat,command 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000 },
    );
    const myPid = process.pid;
    const results: ProcessEntry[] = [];

    for (const line of out.trim().split('\n')) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;
      const cmd = parts.slice(5).join(' ');

      // Claude CLI 프로세스만 필터 (claude, claude-code 모두 매칭)
      if (!CLAUDE_CMD_PATTERN.test(cmd)) continue;
      // 자기 자신 및 자식 제외
      if (pid === myPid || ppid === myPid) continue;
      // claude -p (프롬프트 모드) 프로세스 제외 — 이미 다른 도구가 사용 중
      if (cmd.includes(' -p -') || cmd.includes(" -p '")) continue;

      results.push({
        pid,
        ppid,
        elapsed: parts[2],
        tty: parts[3],
        stat: parts[4],
        command: cmd,
      });
    }
    return results;
  } catch (err) {
    console.error('[clinsight] collectAllClaudeProcessesUnix:', err);
    return [];
  }
}

function collectAllClaudeProcessesWindows(): ProcessEntry[] {
  try {
    // tasklist /V — 상태 포함하여 1회 호출 (N+1 방지)
    const out = execSync(
      'tasklist /FI "IMAGENAME eq claude*" /V /FO CSV /NH 2>nul',
      { encoding: 'utf-8', timeout: 5000 },
    );
    const myPid = process.pid;
    const results: ProcessEntry[] = [];

    for (const line of out.trim().split('\n')) {
      if (!line.trim()) continue;
      // CSV: "이미지이름","PID","세션이름","세션#","메모리","상태",...
      const fields = line.match(/"([^"]*)"/g)?.map((f) => f.replace(/"/g, ''));
      if (!fields || fields.length < 6) continue;
      const pid = parseInt(fields[1], 10);
      if (isNaN(pid) || pid === myPid) continue;

      results.push({
        pid,
        ppid: 0,
        elapsed: 'N/A',
        tty: fields[2] ?? 'N/A',
        stat: fields[5] ?? 'running', // "Running" 또는 "Not Responding"
        command: fields[0] ?? '',
      });
    }
    return results;
  } catch (err) {
    console.error('[clinsight] collectAllClaudeProcessesWindows:', err);
    return [];
  }
}

/**
 * 프로세스 없이 남아있는 세션 디렉토리 찾기
 * activePids: 현재 활성 프로세스 PID 목록 — 이와 연결된 세션은 고아에서 제외
 */
function findOrphanDirs(): OrphanDir[] {
  if (!existsSync(PROJECTS_DIR)) return [];

  // 활성 프로세스의 세션 ID 수집 (JSONL 파일이 최근 수정되었으면 활성)
  const activeSessionIds = new Set<string>();
  try {
    for (const projDir of readdirSync(PROJECTS_DIR)) {
      const projPath = join(PROJECTS_DIR, projDir);
      try {
        if (!statSync(projPath).isDirectory()) continue;
      } catch { continue; }

      for (const entry of readdirSync(projPath)) {
        if (!entry.endsWith('.jsonl')) continue;
        const sessionId = entry.replace('.jsonl', '');
        try {
          const mtime = statSync(join(projPath, entry)).mtime.getTime();
          // JSONL이 최근 30분 내 수정됨 → 활성 세션
          if (Date.now() - mtime < 30 * 60 * 1000) {
            activeSessionIds.add(sessionId);
          }
        } catch { continue; }
      }
    }
  } catch (err) { console.error('[clinsight] activeSessionIds scan:', err); }

  const orphans: OrphanDir[] = [];
  try {
    const projectDirs = readdirSync(PROJECTS_DIR);

    for (const projDir of projectDirs) {
      const projPath = join(PROJECTS_DIR, projDir);
      try {
        if (!statSync(projPath).isDirectory()) continue;
      } catch { continue; }

      const entries = readdirSync(projPath);
      for (const entry of entries) {
        if (entry.endsWith('.jsonl')) continue;
        const entryPath = join(projPath, entry);
        try {
          if (!statSync(entryPath).isDirectory()) continue;
        } catch { continue; }

        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(entry)) continue;

        // 활성 세션이면 고아가 아님 — 건너뛰기
        if (activeSessionIds.has(entry)) continue;

        // 디렉토리가 최근 30분 내 수정되었으면 활성일 수 있으므로 건너뛰기
        try {
          const dirMtime = statSync(entryPath).mtime.getTime();
          if (Date.now() - dirMtime < 30 * 60 * 1000) continue;
        } catch { /* stat 실패 시 고아로 분류 */ }

        orphans.push({
          projectDir: projDir,
          sessionId: entry,
          fullPath: entryPath,
        });
      }
    }
  } catch (err) { console.error('[clinsight] findOrphanDirs:', err); }

  return orphans;
}

/** 좀비 상태 스캔 */
export function scanZombies(): ZombieInfo {
  // 단일 ps 호출로 모든 claude 프로세스 수집 (탐지 기준 통일)
  const allProcesses = IS_WINDOWS
    ? collectAllClaudeProcessesWindows()
    : collectAllClaudeProcessesUnix();

  const zombieProcesses: ZombieProcess[] = [];

  for (const p of allProcesses) {
    const isZombie = IS_WINDOWS
      ? isZombieWindows(p)
      : isZombieUnix(p);

    if (isZombie) {
      zombieProcesses.push({
        pid: p.pid,
        elapsed: p.elapsed,
        tty: p.tty,
        command: p.command.slice(0, 120),
        stat: p.stat,
      });
    }
  }

  const orphanDirs = findOrphanDirs();

  return { processes: zombieProcesses, orphanDirs };
}

/** Unix에서 좀비 판별 */
function isZombieUnix(p: ProcessEntry): boolean {
  // Z(zombie), T(stopped) 상태면 확실한 좀비
  if (/^[ZT]/.test(p.stat)) return true;

  // TTY 없고 경과시간이 2시간 이상인 프로세스 → 좀비 가능성 높음
  if (p.tty === '??' || p.tty === '?') {
    const elapsedHours = parseElapsedToHours(p.elapsed);
    return elapsedHours >= 2;
  }

  // TTY가 있는 경우: 24시간 이상이면 좀비
  const elapsedHours = parseElapsedToHours(p.elapsed);
  return elapsedHours >= 24;
}

/** Windows에서 좀비 판별 — 수집 단계에서 가져온 stat(상태) 기반 */
function isZombieWindows(p: ProcessEntry): boolean {
  // collectAllClaudeProcessesWindows에서 /V 옵션으로 이미 상태를 수집
  const status = p.stat.toLowerCase();
  return status.includes('not responding') || status.includes('응답 없음');
}

/**
 * 좀비 프로세스 킬 — SIGTERM 후 확인, 실패 시 SIGKILL 에스컬레이션
 */
export function killZombieProcess(pid: number): boolean {
  try {
    if (IS_WINDOWS) {
      execSync(`taskkill /PID ${pid} /F 2>nul`, { timeout: 5000 });
      return true;
    }

    // 1단계: SIGTERM
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return false; // 프로세스가 이미 없음
    }

    // 2단계: 1초 대기 후 생존 확인
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      try {
        // signal 0: 프로세스 존재 확인 (실제 시그널 전송 안 함)
        process.kill(pid, 0);
      } catch {
        return true; // 프로세스가 종료됨
      }
      // 100ms 대기
      try { execSync('sleep 0.1', { timeout: 200 }); } catch { /* timeout ok */ }
    }

    // 3단계: SIGKILL 에스컬레이션
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      return true; // 이미 종료됨
    }

    // 4단계: SIGKILL 후 500ms 대기
    const killDeadline = Date.now() + 500;
    while (Date.now() < killDeadline) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
      try { execSync('sleep 0.1', { timeout: 200 }); } catch { /* timeout ok */ }
    }

    // 여전히 살아있으면 실패 (진짜 Z 상태 좀비는 kill로 제거 불가)
    console.error(`[clinsight] PID ${pid}: SIGKILL 후에도 종료되지 않음 (커널 좀비일 수 있음)`);
    return false;
  } catch (err) {
    console.error('[clinsight] killZombieProcess:', err);
    return false;
  }
}

/** 고아 세션 디렉토리 정리 */
export function cleanOrphanDir(orphan: OrphanDir): boolean {
  try {
    rmSync(orphan.fullPath, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.error('[clinsight] cleanOrphanDir:', err);
    return false;
  }
}

/** 모든 좀비 일괄 정리 */
export function cleanAllZombies(): { killedPids: number[]; cleanedDirs: string[] } {
  const info = scanZombies();
  const killedPids: number[] = [];
  const cleanedDirs: string[] = [];

  for (const proc of info.processes) {
    if (killZombieProcess(proc.pid)) killedPids.push(proc.pid);
  }

  for (const orphan of info.orphanDirs) {
    if (cleanOrphanDir(orphan)) cleanedDirs.push(orphan.fullPath);
  }

  return { killedPids, cleanedDirs };
}
