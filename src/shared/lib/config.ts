import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { atomicWriteSync } from './fs-utils.js';

const CONFIG_DIR = join(homedir(), '.claude', 'clinsight');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

/** 모델별 토큰 단가 (USD per 1M tokens) */
export interface PricingEntry {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ClinsightConfig {
  /** 아카이브 보관 일수 (0 = 무제한, 기본값: 90) */
  archiveRetentionDays: number;
  /** 컴파운드 히스토리 보관 일수 (0 = 무제한, 기본값: 30) */
  compoundRetentionDays: number;
  /** 모델별 토큰 단가 오버라이드 (코드 수정 없이 새 모델 가격 추가 가능)
   *  키: 모델명 부분 문자열 (예: 'opus-4-6'), 긴 키부터 매칭
   *  미설정 모델은 내장 기본값 사용 */
  pricing?: Record<string, PricingEntry>;
}

const DEFAULT_CONFIG: ClinsightConfig = {
  archiveRetentionDays: 90,
  compoundRetentionDays: 30,
};

/** 설정 파일 읽기 (없으면 기본값 반환) */
export function loadConfig(): ClinsightConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<ClinsightConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 설정 파일 저장 */
export function saveConfig(config: ClinsightConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  atomicWriteSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/** 설정 파일 경로 (CLI 안내용) */
export { CONFIG_PATH };
