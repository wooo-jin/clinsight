import { writeFileSync, renameSync, unlinkSync, openSync, closeSync, constants as fsConstants } from 'fs';
import { join, dirname } from 'path';

/**
 * Atomic write: 임시 파일에 쓴 후 rename으로 교체
 * 디스크 풀이나 프로세스 중단 시 기존 파일 보호
 */
export function atomicWriteSync(filePath: string, data: string): void {
  const tmpPath = join(dirname(filePath), `.${Date.now()}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  writeFileSync(tmpPath, data);
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * 파일 기반 lock으로 동시 접근 방지 후 fn 실행
 * O_EXCL로 원자적 생성, 완료 후 자동 해제
 */
export function lockFileSync<T>(lockPath: string, fn: () => T): T {
  const fd = openSync(lockPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL);
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  try {
    return fn();
  } finally {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
}
