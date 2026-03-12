/** 토큰 수를 읽기 쉬운 형태로 포맷 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 문자열을 고정 길이로 패딩 */
export function padEnd(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + ' '.repeat(len - str.length);
}

/** 경로에서 마지막 폴더/파일명 추출 (OS 무관) */
export function pathBasename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** 경로 끝에서 N개 세그먼트 추출 (OS 무관) */
export function pathTail(p: string, n: number): string {
  const parts = p.split(/[\\/]/);
  return parts.slice(-n).join('/');
}

/** 문자열 자르기 (한 줄로) */
export function truncate(str: string, len: number): string {
  const singleLine = str.replace(/\n/g, ' ');
  return singleLine.length > len ? singleLine.slice(0, len) + '...' : singleLine;
}
