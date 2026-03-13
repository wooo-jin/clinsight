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
}

export interface OrphanDir {
  projectDir: string;
  sessionId: string;
  fullPath: string;
}

/** 현재 터미널에 연결된 claude 프로세스의 PID 목록 */
function getActivePids(): Set<number> {
  if (IS_WINDOWS) return getActivePidsWindows();
  return getActivePidsUnix();
}

function getActivePidsUnix(): Set<number> {
  try {
    const out = execSync(
      "ps -eo pid,stat,tty,comm 2>/dev/null | grep -i claude | grep 'S\\+\\|R\\+' | awk '{print $1}'",
      { encoding: 'utf-8', timeout: 5000 },
    );
    const pids = new Set<number>();
    for (const line of out.trim().split('\n')) {
      const pid = parseInt(line.trim(), 10);
      if (!isNaN(pid)) pids.add(pid);
    }
    return pids;
  } catch (err) {
    console.error('[clinsight] getActivePidsUnix:', err);
    return new Set();
  }
}

function getActivePidsWindows(): Set<number> {
  try {
    const out = execSync(
      'tasklist /FI "IMAGENAME eq claude*" /FO CSV /NH 2>nul',
      { encoding: 'utf-8', timeout: 5000 },
    );
    const pids = new Set<number>();
    for (const line of out.trim().split('\n')) {
      const match = line.match(/"[^"]*","(\d+)"/);
      if (match) pids.add(parseInt(match[1], 10));
    }
    return pids;
  } catch (err) {
    console.error('[clinsight] getActivePidsWindows:', err);
    return new Set();
  }
}

/** 실제 Claude CLI 프로세스만 조회 */
function getAllClaudeProcesses(): ZombieProcess[] {
  if (IS_WINDOWS) return getAllClaudeProcessesWindows();
  return getAllClaudeProcessesUnix();
}

function getAllClaudeProcessesUnix(): ZombieProcess[] {
  try {
    const out = execSync(
      "ps -eo pid,ppid,etime,tty,stat,command 2>/dev/null | grep -v grep",
      { encoding: 'utf-8', timeout: 5000 },
    );
    const myPid = process.pid;
    const processes: ZombieProcess[] = [];
    for (const line of out.trim().split('\n')) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;
      const cmd = parts.slice(5).join(' ');

      if (!/(?:^|\/)claude\s/.test(cmd) && !/(?:^|\/)claude$/.test(cmd)) continue;
      if (pid === myPid || ppid === myPid) continue;
      if (cmd.includes(' -p -') || cmd.includes(" -p '")) continue;
      processes.push({
        pid,
        elapsed: parts[2],
        tty: parts[3],
        command: cmd.slice(0, 80),
      });
    }
    return processes;
  } catch (err) {
    console.error('[clinsight] getAllClaudeProcessesUnix:', err);
    return [];
  }
}

function getAllClaudeProcessesWindows(): ZombieProcess[] {
  try {
    const out = execSync(
      'wmic process where "name like \'%claude%\'" get ProcessId,CommandLine,SessionId /FORMAT:CSV 2>nul',
      { encoding: 'utf-8', timeout: 5000 },
    );
    const myPid = process.pid;
    const processes: ZombieProcess[] = [];
    for (const line of out.trim().split('\n')) {
      if (!line.trim() || line.startsWith('Node')) continue;
      const parts = line.trim().split(',');
      if (parts.length < 4) continue;
      const cmd = parts[1];
      const pid = parseInt(parts[2], 10);
      if (isNaN(pid) || pid === myPid) continue;
      if (cmd.includes(' -p -') || cmd.includes(" -p '")) continue;
      processes.push({
        pid,
        elapsed: 'N/A',
        tty: parts[3] ?? 'N/A',
        command: cmd.slice(0, 80),
      });
    }
    return processes;
  } catch (err) {
    console.error('[clinsight] getAllClaudeProcessesWindows:', err);
    return [];
  }
}

/** 프로세스 없이 남아있는 세션 디렉토리 찾기 */
function findOrphanDirs(): OrphanDir[] {
  if (!existsSync(PROJECTS_DIR)) return [];

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

/** ps etime 문자열(예: "1-02:03:04", "02:03:04", "03:04")을 시간 단위로 변환 */
function parseElapsedToHours(elapsed: string): number {
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

/** 좀비 상태 스캔 */
export function scanZombies(): ZombieInfo {
  const activePids = getActivePids();
  const allProcesses = getAllClaudeProcesses();

  const zombieProcesses = allProcesses.filter((p) => {
    // 현재 foreground 세션에 연결된 프로세스는 정상
    if (activePids.has(p.pid)) return false;
    if (IS_WINDOWS) return true;
    // TTY 없는 프로세스 → 좀비
    if (p.tty === '??' || p.tty === '?') return true;
    // TTY 있지만 foreground가 아닌 프로세스 → 경과시간/상태 확인 후 판단
    // elapsed가 24시간 이상이거나 stat에 Z(zombie)/T(stopped)가 포함된 경우만 좀비로 분류
    const elapsedHours = parseElapsedToHours(p.elapsed);
    if (elapsedHours >= 24) return true;
    try {
      const statOut = execSync(`ps -o stat= -p ${p.pid} 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim();
      if (/[ZT]/.test(statOut)) return true;
    } catch { /* 프로세스 조회 실패 시 정상으로 간주 */ }
    return false;
  });

  const orphanDirs = findOrphanDirs();

  return { processes: zombieProcesses, orphanDirs };
}

/** 좀비 프로세스 킬 */
export function killZombieProcess(pid: number): boolean {
  try {
    if (IS_WINDOWS) {
      execSync(`taskkill /PID ${pid} /F 2>nul`, { timeout: 5000 });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

/** 고아 세션 디렉토리 정리 */
export function cleanOrphanDir(orphan: OrphanDir): boolean {
  try {
    rmSync(orphan.fullPath, { recursive: true, force: true });
    return true;
  } catch {
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
