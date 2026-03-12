import { describe, it, expect } from 'vitest';
import {
  scanZombies,
  killZombieProcess,
  cleanOrphanDir,
  cleanAllZombies,
} from '../zombie.js';
import type { ZombieInfo, ZombieProcess, OrphanDir } from '../zombie.js';

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

  it('processes 각 항목은 pid, elapsed, command, tty 필드를 갖는다', () => {
    const result = scanZombies();
    for (const proc of result.processes) {
      expect(typeof proc.pid).toBe('number');
      expect(typeof proc.elapsed).toBe('string');
      expect(typeof proc.command).toBe('string');
      expect(typeof proc.tty).toBe('string');
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
    // PID 999999999는 존재하지 않을 가능성이 매우 높음
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
    // rmSync의 { force: true } 옵션은 경로가 없어도 에러를 던지지 않으므로
    // 존재하지 않는 경로에도 true를 반환하는 것이 현재 구현의 올바른 동작
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
