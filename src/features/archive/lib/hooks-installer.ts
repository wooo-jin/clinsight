/**
 * Claude Code settings.json에 clinsight hooks 등록/해제
 */
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { atomicWriteSync } from '../../../shared/lib/fs-utils.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const HOOK_MARKER = 'clinsight';

interface HookEntry {
  matcher: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

interface Settings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

/**
 * hook 실행 명령어 생성
 * 우선순위:
 *   1. clinsight-hook bin이 PATH에 있으면 그대로 사용 (npm global install)
 *   2. 현재 패키지의 dist/hook.js를 node 절대경로로 실행 (소스 설치)
 */
const IS_WINDOWS = process.platform === 'win32';

function buildHookCommand(event: string): string {
  // 1. clinsight-hook bin이 PATH에 있는지 확인
  try {
    const cmd = IS_WINDOWS ? 'where clinsight-hook 2>nul' : 'which clinsight-hook 2>/dev/null';
    const binPath = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim().split('\n')[0]; // Windows `where`는 여러 줄 반환 가능
    if (binPath && existsSync(binPath)) {
      return `${binPath} ${event}`;
    }
  } catch { /* not found */ }

  // 2. 이 파일 기준으로 dist/hook.js 경로 계산
  const thisFile = fileURLToPath(import.meta.url);
  const distDir = dirname(dirname(dirname(dirname(thisFile)))); // lib/ → archive/ → features/ → dist or src
  const hookFromDist = join(distDir, 'hook.js');
  if (existsSync(hookFromDist)) {
    return `"${process.execPath}" "${hookFromDist}" ${event}`;
  }

  // 3. cwd 기반 fallback (개발 환경)
  const devPath = join(process.cwd(), 'dist', 'hook.js');
  return `"${process.execPath}" "${devPath}" ${event}`;
}

function makeHookEntry(event: string): HookEntry {
  return {
    matcher: '',
    hooks: [{
      type: 'command',
      command: buildHookCommand(event),
      timeout: event === 'session-stop' ? 15000 : 5000,
    }],
  };
}

/** 현재 settings.json 읽기 — 파싱 실패 시 null 반환 (빈 객체로 덮어쓰기 방지) */
function readSettings(): Settings | null {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Settings;
  } catch {
    return null; // 파싱 실패 시 원본 보호
  }
}

/** settings.json 저장 (쓰기 전 백업 생성) */
function writeSettings(settings: Settings): void {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  // 기존 파일이 있으면 백업
  if (existsSync(SETTINGS_PATH)) {
    const backupPath = SETTINGS_PATH + '.bak';
    try {
      const original = readFileSync(SETTINGS_PATH, 'utf-8');
      atomicWriteSync(backupPath, original);
    } catch { /* 백업 실패해도 계속 진행 */ }
  }
  atomicWriteSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

/** clinsight 마커가 있는 hook인지 확인 */
function isClinsightHook(entry: HookEntry): boolean {
  return entry.hooks.some((h) =>
    h.command.includes(HOOK_MARKER) || h.command.includes('hook.js session-') || h.command.includes('hook.js prompt-'),
  );
}

/** hooks 설치 */
export function installHooks(): { installed: string[]; skipped: string[]; error?: string } {
  const settings = readSettings();
  if (settings === null) {
    return { installed: [], skipped: [], error: 'settings.json 파싱 실패 — 기존 파일을 보호하기 위해 설치를 중단합니다.' };
  }
  if (!settings.hooks) settings.hooks = {};

  const events: [string, string][] = [
    ['SessionStart', 'session-start'],
    ['UserPromptSubmit', 'prompt-submit'],
    ['Stop', 'session-stop'],
  ];

  const installed: string[] = [];
  const skipped: string[] = [];

  for (const [settingsKey, eventArg] of events) {
    if (!settings.hooks[settingsKey]) settings.hooks[settingsKey] = [];

    const existing = settings.hooks[settingsKey].find(isClinsightHook);
    if (existing) {
      // 이미 있으면 경로만 업데이트
      if (existing.hooks[0]) existing.hooks[0].command = buildHookCommand(eventArg);
      skipped.push(settingsKey);
    } else {
      settings.hooks[settingsKey].push(makeHookEntry(eventArg));
      installed.push(settingsKey);
    }
  }

  writeSettings(settings);
  return { installed, skipped };
}

/** hooks 제거 */
export function uninstallHooks(): string[] {
  const settings = readSettings();
  if (!settings || !settings.hooks) return [];

  const removed: string[] = [];
  for (const [key, entries] of Object.entries(settings.hooks)) {
    const filtered = entries.filter((e) => !isClinsightHook(e));
    if (filtered.length !== entries.length) {
      removed.push(key);
      if (filtered.length === 0) {
        delete settings.hooks[key];
      } else {
        settings.hooks[key] = filtered;
      }
    }
  }

  if (Object.keys(settings.hooks!).length === 0) delete settings.hooks;
  writeSettings(settings);
  return removed;
}

/** hooks 설치 상태 확인 */
export function checkHooksStatus(): { event: string; installed: boolean; command: string }[] {
  const settings = readSettings() ?? {};
  const events = ['SessionStart', 'UserPromptSubmit', 'Stop'];

  return events.map((event) => {
    const entries = settings.hooks?.[event] ?? [];
    const hook = entries.find(isClinsightHook);
    return {
      event,
      installed: !!hook,
      command: hook?.hooks[0]?.command ?? '',
    };
  });
}
