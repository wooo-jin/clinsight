import { join } from 'path';
import { homedir } from 'os';

/** Claude 설정 디렉토리 */
export const CLAUDE_DIR = join(homedir(), '.claude');

/** Claude 프로젝트 세션 디렉토리 */
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

/** Clinsight 결과 저장 디렉토리 */
export const COMPOUND_DIR = join(CLAUDE_DIR, 'clinsight', 'compounds');

/** 분석에 사용되는 기준값 */
export const ANALYSIS = {
  /** 반복 편집 경고 임계치 */
  REPEATED_EDIT_WARNING: 4,
  /** 반복 편집 심각 임계치 */
  REPEATED_EDIT_CRITICAL: 6,
  /** 불필요 탐색 파일 수 경고 임계치 */
  UNUSED_READ_WARNING: 10,
  /** 세션 길이 경고 (분) */
  SESSION_DURATION_WARNING: 60,
  /** 세션 길이 심각 임계치 (분) */
  SESSION_DURATION_CRITICAL: 90,
  /** 세션 비용 경고 임계치 (USD) */
  SESSION_COST_WARNING: 10,
  /** 세션 비용 심각 임계치 (USD) */
  SESSION_COST_CRITICAL: 30,
  /** Claude 컨텍스트 윈도우 크기 (200K) */
  CONTEXT_WINDOW_SIZE: 200_000,
  /** 컨텍스트 경고 임계치 (75%) */
  CONTEXT_WARNING: 150_000,
  /** 컨텍스트 심각 임계치 (90%) */
  CONTEXT_CRITICAL: 180_000,
  /** 반복 편집 시 추정 낭비 토큰/회 */
  TOKENS_PER_REPEATED_EDIT: 2_000,
  /** 불필요 파일 읽기 시 추정 낭비 토큰/파일 */
  TOKENS_PER_UNUSED_READ: 500,
  /** 토큰 절약 → USD 변환 계수 (input 기준 평균) */
  TOKEN_TO_USD_FACTOR: 0.000015,
} as const;

/** JSONL 파일 최대 읽기 크기 (50MB) — OOM 방지 */
export const MAX_JSONL_SIZE = 50 * 1024 * 1024;

/** 최근 로드할 세션 수 기본값 */
export const DEFAULT_SESSION_COUNT = 50;

/** 컴파운드 히스토리 최대 보관 일수 */
export const COMPOUND_HISTORY_MAX = 30;

/** 컴파운드 Claude CLI 호출 타임아웃 (ms) */
export const COMPOUND_TIMEOUT_MS = 180_000;

/** 컴파운드 분석 모델 (Sonnet이 Opus보다 ~3배 빠름) */
export const COMPOUND_MODEL = 'claude-sonnet-4-6';

/** 컴파운드 프롬프트 최대 길이 (문자) */
export const COMPOUND_PROMPT_MAX_LENGTH = 50_000;

/** 모델별 컨텍스트 윈도우 크기 (토큰) — 구체적인 키가 먼저 (includes 매칭 시 우선) */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'sonnet-3-5': 200_000,
  'haiku-3-5': 200_000,
  'opus-4': 200_000,
  'sonnet-4': 200_000,
  'haiku-4': 200_000,
};

/** 모델명에서 컨텍스트 윈도우 크기 조회 (매칭 실패 시 기본값 200K) */
export function getContextWindowSize(model: string): number {
  const entry = Object.entries(MODEL_CONTEXT_WINDOWS).find(([key]) => model.includes(key));
  return entry ? entry[1] : ANALYSIS.CONTEXT_WINDOW_SIZE;
}

/** 기능 사용 카테고리 라벨 (Dashboard/Insights 공용) */
export const FEATURE_LABELS: Record<string, string> = {
  agent: '🤖 Agent/팀',
  skill: '⚡ 스킬',
  command: '💻 커맨드',
  mcp: '🔌 MCP',
  task: '📋 태스크',
  web: '🌐 웹',
  exploration: '🔍 탐색',
  editing: '✏️ 편집',
};
