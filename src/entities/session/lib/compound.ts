import { spawn, execFileSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  ParsedSession, CompoundResult, GoldenPrompt,
  PreventionRule, CompoundClassification,
} from '../../../shared/types/session.js';
import { analyzeSession } from './analyzer.js';
import { atomicWriteSync, lockFileSync } from '../../../shared/lib/fs-utils.js';
import { COMPOUND_TIMEOUT_MS, COMPOUND_PROMPT_MAX_LENGTH, COMPOUND_HISTORY_MAX, COMPOUND_MODEL, COMPOUND_DIR } from '../../../shared/lib/constants.js';
import { loadConfig } from '../../../shared/lib/config.js';
import { buildCompoundPrompt, formatSessionForCompound } from './compound-prompt.js';

const HISTORY_FILE = join(COMPOUND_DIR, 'history.json');

/** 컴파운드 결과를 history.json에 저장 (개수 기반 + 날짜 기반 이중 필터) */
function saveCompoundResult(result: CompoundResult): void {
  mkdirSync(COMPOUND_DIR, { recursive: true });
  const lockPath = HISTORY_FILE + '.lock';
  try {
    lockFileSync(lockPath, () => {
      let history: CompoundResult[] = [];
      if (existsSync(HISTORY_FILE)) {
        try {
          history = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8')) as CompoundResult[];
        } catch { history = []; }
      }
      history.unshift(result);

      // 개수 기반 제한
      history = history.slice(0, COMPOUND_HISTORY_MAX);

      // 날짜 기반 제한 (compoundRetentionDays)
      const config = loadConfig();
      if (config.compoundRetentionDays > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - config.compoundRetentionDays);
        const cutoffStr = cutoff.toISOString().split('T')[0];
        history = history.filter((h) => (h.date ?? '') >= cutoffStr);
      }

      atomicWriteSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    });
  } catch (err) {
    // lock 획득 실패 시 (다른 프로세스가 저장 중) lock 없이 시도
    console.error('[clinsight] saveCompoundResult lock failed, retrying without lock:', err);
    let history: CompoundResult[] = [];
    if (existsSync(HISTORY_FILE)) {
      try {
        history = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8')) as CompoundResult[];
      } catch { history = []; }
    }
    history.unshift(result);
    history = history.slice(0, COMPOUND_HISTORY_MAX);
    atomicWriteSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  }
}

/** spawn + stdin 기반 비동기 실행 */
function spawnWithStdin(cmd: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      reject(new Error('timeout'));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code !== 0) return reject(new Error(`exit code ${code}`));
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });

    child.stdin.write(input);
    child.stdin.end();
  });
}

/** 세션 목록에서 날짜 범위를 추출 */
export function getDateRange(sessions: ParsedSession[]): { from: string; to: string } {
  if (sessions.length === 0) return { from: '-', to: '-' };
  const sorted = [...sessions].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');
  return { from: fmt(sorted[0].startTime), to: fmt(sorted[sorted.length - 1].endTime) };
}

/** Claude Code CLI를 사용한 비동기 세션 데이터 심층 분석 */
export async function runCompoundAsync(sessions: ParsedSession[]): Promise<CompoundResult> {
  const analyses = sessions.map((s) => analyzeSession(s));
  let summaryData = formatSessionForCompound(sessions, analyses);

  if (summaryData.length > COMPOUND_PROMPT_MAX_LENGTH) {
    summaryData = summaryData.slice(0, COMPOUND_PROMPT_MAX_LENGTH) + '\n\n(이하 생략)';
  }

  const prompt = buildCompoundPrompt(summaryData);

  try {
    const stdout = await spawnWithStdin(
      'claude', ['-p', '-', '--model', COMPOUND_MODEL],
      prompt, COMPOUND_TIMEOUT_MS,
    );

    const parsed = extractJson(stdout);
    const compoundResult = buildCompoundResult(parsed);
    compoundResult.sessionCount = sessions.length;
    compoundResult.dateRange = getDateRange(sessions);

    saveCompoundResult(compoundResult);
    return compoundResult;
  } catch (err) {
    const errResult = emptyResult();
    const msg = err instanceof Error ? err.message : String(err);
    errResult.classification = {
      types: ['error'],
      domains: [],
      complexity: 'low',
      summary: `분석 실패: ${msg}`,
    };
    return errResult;
  }
}

/** 동기 버전 (cron용) */
export function runCompound(sessions: ParsedSession[]): CompoundResult {
  const analyses = sessions.map((s) => analyzeSession(s));
  let summaryData = formatSessionForCompound(sessions, analyses);

  if (summaryData.length > COMPOUND_PROMPT_MAX_LENGTH) {
    summaryData = summaryData.slice(0, COMPOUND_PROMPT_MAX_LENGTH) + '\n\n(이하 생략)';
  }

  const prompt = buildCompoundPrompt(summaryData);

  try {
    const result = execFileSync('claude', ['-p', '-', '--model', COMPOUND_MODEL], {
      encoding: 'utf-8',
      timeout: COMPOUND_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      input: prompt,
    });

    const parsed = extractJson(result);
    const compoundResult = buildCompoundResult(parsed);
    compoundResult.sessionCount = sessions.length;
    compoundResult.dateRange = getDateRange(sessions);

    saveCompoundResult(compoundResult);
    return compoundResult;
  } catch (err) {
    const errResult = emptyResult();
    const msg = err instanceof Error ? err.message : String(err);
    errResult.classification = {
      types: ['error'],
      domains: [],
      complexity: 'low',
      summary: `동기 분석 실패: ${msg}`,
    };
    return errResult;
  }
}

// ── 결과 파싱 ──

function buildCompoundResult(parsed: Record<string, unknown>): CompoundResult {
  return {
    date: new Date().toISOString().split('T')[0],
    patterns: asStringArray(parsed.patterns),
    solutions: asStringArray(parsed.solutions),
    conventions: asStringArray(parsed.conventions),
    goldenPrompts: asGoldenPrompts(parsed.goldenPrompts),
    preventionRules: asPreventionRules(parsed.preventionRules),
    classification: asClassification(parsed.classification),
  };
}

function emptyResult(): CompoundResult {
  return {
    date: new Date().toISOString().split('T')[0],
    patterns: [], solutions: [], conventions: [], goldenPrompts: [],
    preventionRules: [], classification: undefined,
  };
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === 'string');
}

function asGoldenPrompts(val: unknown): GoldenPrompt[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((gp) => ({
      prompt: String(gp.prompt ?? ''),
      sessionId: '',
      result: String(gp.result ?? ''),
      filesCreated: 0,
      retriesNeeded: 0,
    }));
}

function asPreventionRules(val: unknown): PreventionRule[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((r) => ({
      category: validateCategory(String(r.category ?? 'convention')),
      rule: String(r.rule ?? ''),
      reason: String(r.reason ?? ''),
      scope: r.scope ? String(r.scope) : 'global',
    }))
    .filter((r) => r.rule.length > 0);
}

function validateCategory(cat: string): PreventionRule['category'] {
  const valid: PreventionRule['category'][] = ['claude-md', 'lint', 'type', 'test', 'convention'];
  return valid.includes(cat as PreventionRule['category']) ? cat as PreventionRule['category'] : 'convention';
}

function asClassification(val: unknown): CompoundClassification | undefined {
  if (!val || typeof val !== 'object') return undefined;
  const obj = val as Record<string, unknown>;
  return {
    types: asStringArray(obj.types),
    domains: asStringArray(obj.domains),
    complexity: (['low', 'medium', 'high'].includes(String(obj.complexity)) ? String(obj.complexity) : 'medium') as 'low' | 'medium' | 'high',
    summary: String(obj.summary ?? ''),
  };
}

// ── JSON 추출 ──

/** @internal 테스트용 export */
export function extractJson(text: string): Record<string, unknown> {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;

  try {
    return JSON.parse(jsonStr.trim()) as Record<string, unknown>;
  } catch {
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd !== -1) {
      try {
        return JSON.parse(jsonStr.slice(braceStart, braceEnd + 1)) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }
}
