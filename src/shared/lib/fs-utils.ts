import { writeFileSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Atomic write: 임시 파일에 쓴 후 rename으로 교체
 * 디스크 풀이나 프로세스 중단 시 기존 파일 보호
 */
export function atomicWriteSync(filePath: string, data: string): void {
  const tmpPath = join(dirname(filePath), `.${Date.now()}.tmp`);
  writeFileSync(tmpPath, data);
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
