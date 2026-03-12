import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { atomicWriteSync } from './fs-utils.js';

const CONFIG_DIR = join(homedir(), '.claude', 'clinsight');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export interface ClinsightConfig {
  /** 아카이브 보관 일수 (0 = 무제한, 기본값: 0) */
  archiveRetentionDays: number;
  /** 컴파운드 히스토리 보관 일수 (0 = 무제한, 기본값: 30) */
  compoundRetentionDays: number;
}

const DEFAULT_CONFIG: ClinsightConfig = {
  archiveRetentionDays: 0,
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
