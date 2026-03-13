import { describe, it, expect } from 'vitest';
import { generateSessionSummary } from '../archive-writer.js';

describe('generateSessionSummary', () => {
  it('첫 번째 프롬프트를 요약으로 사용한다', () => {
    const result = generateSessionSummary(['버그 수정해줘'], []);
    expect(result).toBe('버그 수정해줘');
  });

  it('짧은 프롬프트(5자 이하)를 건너뛰고 의미 있는 프롬프트를 사용한다', () => {
    const result = generateSessionSummary(['ㅇㅇ', '로그인 페이지 리팩토링 해줘'], []);
    expect(result).toBe('로그인 페이지 리팩토링 해줘');
  });

  it('개행과 탭을 공백으로 치환한다', () => {
    const result = generateSessionSummary(['첫 줄\n두 번째 줄\t탭'], []);
    expect(result).toBe('첫 줄 두 번째 줄 탭');
  });

  it('80자 초과 시 말줄임 처리한다', () => {
    const longPrompt = 'a'.repeat(100);
    const result = generateSessionSummary([longPrompt], []);
    expect(result).toContain('…');
    // 편집 파일이 없으므로 말줄임만
    expect(result.indexOf('…')).toBe(79);
  });

  it('편집 파일 수를 부기한다', () => {
    const result = generateSessionSummary(
      ['API 엔드포인트 추가'],
      ['src/api.ts', 'src/routes.ts', 'src/types.ts'],
    );
    expect(result).toContain('[3개 파일 수정]');
    expect(result).toContain('API 엔드포인트 추가');
  });

  it('프롬프트가 없으면 빈 문자열을 반환한다', () => {
    const result = generateSessionSummary([], []);
    expect(result).toBe('');
  });

  it('모든 프롬프트가 짧으면 첫 번째를 사용한다', () => {
    const result = generateSessionSummary(['네', '응'], ['file.ts']);
    expect(result).toContain('네');
    expect(result).toContain('[1개 파일 수정]');
  });
});
