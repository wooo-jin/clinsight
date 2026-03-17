import { writeFileSync, renameSync, unlinkSync, openSync, readSync, closeSync, readFileSync, statSync, constants as fsConstants } from 'fs';
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
    try { unlinkSync(tmpPath); } catch (e) { console.error('[clinsight] cleanup tmp:', e); }
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
    try { unlinkSync(lockPath); } catch (err) { console.error('[clinsight] unlock:', err); }
  }
}

/**
 * 파일 앞부분만 안전하게 읽기 (OOM 방지: 대용량 파일에서 전체 로드 없이 제한 크기만 읽음)
 * UTF-8 멀티바이트 경계 안전 처리: 마지막 완전한 줄까지만 반환
 */
export function readFileSafe(filePath: string, maxSize: number): { content: string; truncated: boolean } {
  let fileSize: number;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    return { content: '', truncated: false };
  }
  if (fileSize <= maxSize) {
    return { content: readFileSync(filePath, 'utf-8'), truncated: false };
  }
  // 대용량 파일: fd 기반으로 앞부분만 읽기 (readFileSync().slice()는 전체를 메모리에 올림)
  const buf = Buffer.alloc(maxSize);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buf, 0, maxSize, 0);
  } finally {
    closeSync(fd);
  }
  // 절단 시 마지막 완전한 줄(\n)까지만 사용 — 불완전한 JSON 라인 및 UTF-8 경계 방지
  const raw = buf.toString('utf-8');
  const lastNewline = raw.lastIndexOf('\n');
  const content = lastNewline > 0 ? raw.slice(0, lastNewline) : raw;
  return { content, truncated: true };
}
