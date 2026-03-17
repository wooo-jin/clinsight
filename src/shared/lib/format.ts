/** 토큰 수를 읽기 쉬운 형태로 포맷 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 문자의 표시 너비 (전각=2, 반각=1) */
function charWidth(code: number): number {
  // CJK Unified Ideographs, Hangul Syllables, Fullwidth Forms, etc.
  if (
    (code >= 0x1100 && code <= 0x115F) ||  // Hangul Jamo
    (code >= 0x231A && code <= 0x23FF) ||  // Misc Technical (⌚, ⏰ 등)
    (code >= 0x2600 && code <= 0x27BF) ||  // Misc Symbols, Dingbats (☀, ✅ 등)
    (code >= 0x2B50 && code <= 0x2B55) ||  // Stars, circles
    (code >= 0x2E80 && code <= 0x303E) ||  // CJK Radicals
    (code >= 0x3040 && code <= 0x33BF) ||  // Hiragana, Katakana, CJK
    (code >= 0x3400 && code <= 0x4DBF) ||  // CJK Unified Ext A
    (code >= 0x4E00 && code <= 0xA4CF) ||  // CJK Unified + Yi
    (code >= 0xAC00 && code <= 0xD7AF) ||  // Hangul Syllables
    (code >= 0xF900 && code <= 0xFAFF) ||  // CJK Compatibility
    (code >= 0xFE30 && code <= 0xFE6F) ||  // CJK Compatibility Forms
    (code >= 0xFF01 && code <= 0xFF60) ||  // Fullwidth Forms
    (code >= 0xFFE0 && code <= 0xFFE6) ||  // Fullwidth Signs
    (code >= 0x1F000 && code <= 0x1FAFF) || // Emoji (🔥, 📊, 💡, 🤖, 📝, ❓, 🔄 등)
    (code >= 0x1FB00 && code <= 0x1FBFF) || // Symbols for Legacy Computing
    (code >= 0x20000 && code <= 0x2FA1F)   // CJK Ext B-F
  ) {
    return 2;
  }
  return 1;
}

/** 문자열의 표시 너비 (전각 문자는 2칸) */
function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += charWidth(ch.codePointAt(0)!);
  }
  return w;
}

/** 문자열을 고정 표시 너비로 패딩 (한글/이모지 전각 2칸 고려) */
export function padEnd(str: string, len: number): string {
  const w = displayWidth(str);
  if (w >= len) {
    // 표시 너비 기준으로 자르기
    let acc = 0;
    let i = 0;
    for (const ch of str) {
      const cw = charWidth(ch.codePointAt(0)!);
      if (acc + cw > len) break;
      acc += cw;
      i += ch.length;
    }
    return str.slice(0, i);
  }
  return str + ' '.repeat(len - w);
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
