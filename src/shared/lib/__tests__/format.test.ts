import { describe, it, expect } from 'vitest';
import { formatTokens, padEnd, truncate } from '../format.js';

describe('formatTokens', () => {
  it('1M 이상은 M으로 표시', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(formatTokens(2_000_000)).toBe('2.0M');
  });

  it('1K 이상은 K로 표시', () => {
    expect(formatTokens(1_500)).toBe('1.5K');
    expect(formatTokens(500_000)).toBe('500.0K');
  });

  it('1K 미만은 그대로 표시', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(0)).toBe('0');
  });
});

describe('padEnd', () => {
  it('짧은 문자열을 패딩', () => {
    expect(padEnd('hi', 5)).toBe('hi   ');
  });

  it('긴 문자열은 잘라냄', () => {
    expect(padEnd('hello world', 5)).toBe('hello');
  });

  it('정확한 길이는 그대로', () => {
    expect(padEnd('hello', 5)).toBe('hello');
  });

  it('한글 전각 문자를 2칸으로 계산', () => {
    // '가' = 2칸, 총 표시너비 2 → 3칸 패딩 필요
    expect(padEnd('가', 5)).toBe('가   ');
  });

  it('한글이 포함된 긴 문자열은 표시 너비 기준으로 자름', () => {
    // '가나다' = 6칸 → 5칸 기준으로 자르면 '가나' (4칸)
    expect(padEnd('가나다', 5)).toBe('가나');
  });
});

describe('truncate', () => {
  it('긴 문자열을 잘라내고 ... 추가', () => {
    expect(truncate('hello world this is long', 10)).toBe('hello worl...');
  });

  it('짧은 문자열은 그대로', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('줄바꿈을 공백으로 변환', () => {
    expect(truncate('hello\nworld', 20)).toBe('hello world');
  });
});
