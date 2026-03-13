import { describe, it, expect } from 'vitest';
import { extractJson } from '../compound.js';

describe('extractJson', () => {
  it('순수 JSON 문자열을 파싱한다', () => {
    const result = extractJson('{"patterns": ["a", "b"]}');
    expect(result).toEqual({ patterns: ['a', 'b'] });
  });

  it('코드 블록 안의 JSON을 추출한다', () => {
    const text = '다음은 분석 결과입니다.\n```json\n{"patterns": ["x"]}\n```\n끝.';
    const result = extractJson(text);
    expect(result).toEqual({ patterns: ['x'] });
  });

  it('언어 지정 없는 코드 블록도 처리한다', () => {
    const text = '```\n{"solutions": ["sol1"]}\n```';
    const result = extractJson(text);
    expect(result).toEqual({ solutions: ['sol1'] });
  });

  it('코드 블록 외부에 텍스트가 섞인 JSON을 중괄호 기반으로 추출한다', () => {
    const text = '분석 결과:\n{"conventions": ["c1"]}\n위와 같습니다.';
    const result = extractJson(text);
    expect(result).toEqual({ conventions: ['c1'] });
  });

  it('JSON 앞뒤에 텍스트가 있으면 중괄호 범위로 추출한다', () => {
    const text = 'Here is the result: {"key": "value"} end of response';
    const result = extractJson(text);
    expect(result).toEqual({ key: 'value' });
  });

  it('유효하지 않은 JSON은 빈 객체를 반환한다', () => {
    const result = extractJson('이것은 JSON이 아닙니다');
    expect(result).toEqual({});
  });

  it('빈 문자열은 빈 객체를 반환한다', () => {
    const result = extractJson('');
    expect(result).toEqual({});
  });

  it('중괄호가 있지만 유효하지 않은 JSON은 빈 객체를 반환한다', () => {
    const result = extractJson('{ invalid json content }');
    expect(result).toEqual({});
  });

  it('중첩 객체가 있는 JSON을 파싱한다', () => {
    const text = '```json\n{"classification": {"types": ["feature"], "complexity": "high"}}\n```';
    const result = extractJson(text);
    expect(result).toEqual({
      classification: { types: ['feature'], complexity: 'high' },
    });
  });

  it('코드 블록 내 JSON 앞뒤 공백을 제거한다', () => {
    const text = '```json\n\n  {"key": "val"}  \n\n```';
    const result = extractJson(text);
    expect(result).toEqual({ key: 'val' });
  });
});
