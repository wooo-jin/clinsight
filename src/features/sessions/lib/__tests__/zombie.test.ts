import { describe, it, expect } from 'vitest';
import {
  scanZombies,
  killZombieProcess,
  cleanOrphanDir,
  cleanAllZombies,
  parseElapsedToHours,
} from '../zombie.js';
import type { ZombieInfo, OrphanDir } from '../zombie.js';

// ─────────────────────────────────────────────
// parseElapsedToHours 단위 테스트
// ─────────────────────────────────────────────
describe('parseElapsedToHours', () => {
  it('HH:MM:SS 포맷을 올바르게 변환한다', () => {
    expect(parseElapsedToHours('02:30:00')).toBeCloseTo(2.5);
  });

  it('MM:SS 포맷을 올바르게 변환한다 (분 단위)', () => {
    // 30:00 = 30분 = 0.5시간
    expect(parseElapsedToHours('30:00')).toBeCloseTo(0.5);
  });

  it('D-HH:MM:SS 포맷 (일 포함)을 올바르게 변환한다', () => {
    // 1-12:00:00 = 1일 12시간 = 36시간
    expect(parseElapsedToHours('1-12:00:00')).toBeCloseTo(36);
  });

  it('0-00:00:00 포맷을 0으로 변환한다', () => {
    expect(parseElapsedToHours('0-00:00:00')).toBe(0);
  });

  it('00:30 포맷 (30초)을 올바르게 변환한다', () => {
    // 00:30 = 0분 30초 → 0/60 = 0시간
    expect(parseElapsedToHours('00:30')).toBe(0);
  });

  it('03:04 포맷 (3분 4초)을 올바르게 변환한다', () => {
    // 03:04 = 3분 → 3/60 = 0.05시간
    expect(parseElapsedToHours('03:04')).toBeCloseTo(0.05);
  });

  it('7-00:00:00 포맷 (7일)을 올바르게 변환한다', () => {
    expect(parseElapsedToHours('7-00:00:00')).toBe(168);
  });

  it('빈 문자열에 대해 0을 반환한다', () => {
    expect(parseElapsedToHours('')).toBe(0);
  });

  it('잘못된 포맷에 대해 0을 반환한다', () => {
    expect(parseElapsedToHours('invalid')).toBe(0);
  });

  it('N/A에 대해 0을 반환한다', () => {
    expect(parseElapsedToHours('N/A')).toBe(0);
  });
});

// ─────────────────────────────────────────────
// zombie 모듈 exports 검증
// ─────────────────────────────────────────────
describe('zombie 모듈 exports', () => {
  it('scanZombies 함수를 export한다', () => {
    expect(typeof scanZombies).toBe('function');
  });

  it('killZombieProcess 함수를 export한다', () => {
    expect(typeof killZombieProcess).toBe('function');
  });

  it('cleanOrphanDir 함수를 export한다', () => {
    expect(typeof cleanOrphanDir).toBe('function');
  });

  it('cleanAllZombies 함수를 export한다', () => {
    expect(typeof cleanAllZombies).toBe('function');
  });
});

// ─────────────────────────────────────────────
// scanZombies 반환값 구조 검증
// ─────────────────────────────────────────────
describe('scanZombies', () => {
  it('processes와 orphanDirs 배열을 포함하는 객체를 반환한다', () => {
    const result: ZombieInfo = scanZombies();
    expect(result).toHaveProperty('processes');
    expect(result).toHaveProperty('orphanDirs');
    expect(Array.isArray(result.processes)).toBe(true);
    expect(Array.isArray(result.orphanDirs)).toBe(true);
  });

  it('processes 각 항목은 pid, elapsed, command, tty, stat 필드를 갖는다', () => {
    const result = scanZombies();
    for (const proc of result.processes) {
      expect(typeof proc.pid).toBe('number');
      expect(typeof proc.elapsed).toBe('string');
      expect(typeof proc.command).toBe('string');
      expect(typeof proc.tty).toBe('string');
      expect(typeof proc.stat).toBe('string');
    }
  });

  it('orphanDirs 각 항목은 projectDir, sessionId, fullPath 필드를 갖는다', () => {
    const result = scanZombies();
    for (const orphan of result.orphanDirs) {
      expect(typeof orphan.projectDir).toBe('string');
      expect(typeof orphan.sessionId).toBe('string');
      expect(typeof orphan.fullPath).toBe('string');
    }
  });
});

// ─────────────────────────────────────────────
// killZombieProcess 동작 검증
// ─────────────────────────────────────────────
describe('killZombieProcess', () => {
  it('존재하지 않는 PID에 대해 false를 반환한다', () => {
    const result = killZombieProcess(999_999_999);
    expect(result).toBe(false);
  });

  it('boolean 값을 반환한다', () => {
    const result = killZombieProcess(999_999_999);
    expect(typeof result).toBe('boolean');
  });
});

// ─────────────────────────────────────────────
// cleanOrphanDir 동작 검증
// ─────────────────────────────────────────────
describe('cleanOrphanDir', () => {
  it('boolean 값을 반환한다', () => {
    const orphan: OrphanDir = {
      projectDir: 'test',
      sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      fullPath: '/tmp/non-existent-zombie-test-dir-xyz',
    };
    const result = cleanOrphanDir(orphan);
    expect(typeof result).toBe('boolean');
  });

  it('존재하지 않는 경로도 force 옵션으로 에러 없이 true를 반환한다', () => {
    const orphan: OrphanDir = {
      projectDir: 'non-existent-project',
      sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      fullPath: '/tmp/non-existent-zombie-test-dir-xyz',
    };
    const result = cleanOrphanDir(orphan);
    expect(result).toBe(true);
  });
});

// ─────────────────────────────────────────────
// cleanAllZombies 반환값 구조 검증
// ─────────────────────────────────────────────
describe('cleanAllZombies', () => {
  it('killedPids와 cleanedDirs 배열을 포함하는 객체를 반환한다', () => {
    const result = cleanAllZombies();
    expect(result).toHaveProperty('killedPids');
    expect(result).toHaveProperty('cleanedDirs');
    expect(Array.isArray(result.killedPids)).toBe(true);
    expect(Array.isArray(result.cleanedDirs)).toBe(true);
  });

  it('killedPids는 숫자 배열이다', () => {
    const result = cleanAllZombies();
    for (const pid of result.killedPids) {
      expect(typeof pid).toBe('number');
    }
  });

  it('cleanedDirs는 문자열 배열이다', () => {
    const result = cleanAllZombies();
    for (const dir of result.cleanedDirs) {
      expect(typeof dir).toBe('string');
    }
  });
});
