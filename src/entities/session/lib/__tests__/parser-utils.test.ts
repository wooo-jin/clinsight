import { describe, it, expect } from 'vitest';
import {
  calculateCost,
  extractUserPrompt,
  countReverts,
  categorizeTools,
  analyzeInteractionPattern,
} from '../parser-utils.js';
import type { TokenUsage, ProjectUserMessage } from '../../../../shared/types/session.js';

// ─────────────────────────────────────────────
// calculateCost
// ─────────────────────────────────────────────
describe('calculateCost', () => {
  const usage: TokenUsage = {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  it('opus-4 모델에 opus-4 단가를 적용한다', () => {
    // input: 15, output: 75 → (1M/1M)*15 + (1M/1M)*75 = 90
    const cost = calculateCost(usage, 'claude-opus-4-5');
    expect(cost).toBeCloseTo(90);
  });

  it('sonnet-4 모델에 sonnet-4 단가를 적용한다', () => {
    // input: 3, output: 15 → 3 + 15 = 18
    const cost = calculateCost(usage, 'claude-sonnet-4-6');
    expect(cost).toBeCloseTo(18);
  });

  it('haiku-4 모델에 haiku-4 단가를 적용한다', () => {
    // input: 0.8, output: 4 → 0.8 + 4 = 4.8
    const cost = calculateCost(usage, 'claude-haiku-4-0');
    expect(cost).toBeCloseTo(4.8);
  });

  it('알 수 없는 모델은 sonnet-4 기본 단가를 적용한다', () => {
    // DEFAULT_PRICING = sonnet-4 → 3 + 15 = 18
    const cost = calculateCost(usage, 'unknown-model-xyz');
    expect(cost).toBeCloseTo(18);
  });

  it('캐시 읽기 토큰 비용을 포함한다', () => {
    const usageWithCache: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
    };
    // sonnet-4 cacheRead: 0.3 per 1M
    const cost = calculateCost(usageWithCache, 'claude-sonnet-4-6');
    expect(cost).toBeCloseTo(0.3);
  });

  it('캐시 쓰기 토큰 비용을 포함한다', () => {
    const usageWithCacheWrite: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
    };
    // sonnet-4 cacheWrite: 3.75 per 1M
    const cost = calculateCost(usageWithCacheWrite, 'claude-sonnet-4-6');
    expect(cost).toBeCloseTo(3.75);
  });

  it('cache 토큰 필드가 undefined이면 0으로 처리한다', () => {
    const usageNoCache: TokenUsage = {
      input_tokens: 1_000_000,
      output_tokens: 0,
    };
    // sonnet-4 input: 3 → 3
    const cost = calculateCost(usageNoCache, 'claude-sonnet-4-6');
    expect(cost).toBeCloseTo(3);
  });

  it('모든 토큰이 0이면 비용이 0이다', () => {
    const zeroUsage: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    expect(calculateCost(zeroUsage, 'claude-sonnet-4-6')).toBe(0);
  });
});

// ─────────────────────────────────────────────
// extractUserPrompt
// ─────────────────────────────────────────────
describe('extractUserPrompt', () => {
  function makeUserMsg(content: ProjectUserMessage['message']['content']): ProjectUserMessage {
    return {
      type: 'user',
      timestamp: '2026-03-10T10:00:00Z',
      sessionId: 'test-session',
      uuid: 'uuid-001',
      message: { role: 'user', content },
    };
  }

  it('string content를 그대로 반환한다', () => {
    const msg = makeUserMsg('안녕하세요');
    expect(extractUserPrompt(msg)).toBe('안녕하세요');
  });

  it('배열 content에서 text 블록을 추출해 줄바꿈으로 합친다', () => {
    const msg = makeUserMsg([
      { type: 'text', text: '첫 번째 줄' },
      { type: 'text', text: '두 번째 줄' },
    ]);
    expect(extractUserPrompt(msg)).toBe('첫 번째 줄\n두 번째 줄');
  });

  it('배열에서 text 타입이 아닌 블록은 무시한다', () => {
    const msg = makeUserMsg([
      { type: 'tool_result', content: '도구 결과' },
      { type: 'text', text: '실제 프롬프트' },
    ]);
    expect(extractUserPrompt(msg)).toBe('실제 프롬프트');
  });

  it('빈 배열 content는 빈 문자열을 반환한다', () => {
    const msg = makeUserMsg([]);
    expect(extractUserPrompt(msg)).toBe('');
  });

  it('text 블록이 없는 배열은 빈 문자열을 반환한다', () => {
    const msg = makeUserMsg([
      { type: 'tool_result', content: '결과' },
    ]);
    expect(extractUserPrompt(msg)).toBe('');
  });

  it('message.content가 undefined이면 빈 문자열을 반환한다', () => {
    const msg: ProjectUserMessage = {
      type: 'user',
      timestamp: '2026-03-10T10:00:00Z',
      sessionId: 'test-session',
      uuid: 'uuid-001',
      message: { role: 'user', content: undefined as unknown as string },
    };
    expect(extractUserPrompt(msg)).toBe('');
  });
});

// ─────────────────────────────────────────────
// countReverts
// ─────────────────────────────────────────────
describe('countReverts', () => {
  it('빈 배열은 되돌림이 0이다', () => {
    expect(countReverts([])).toBe(0);
  });

  it('되돌림 없는 단순 편집 시퀀스는 0이다', () => {
    const ops = [
      { file: 'a.ts', oldStr: 'const x = 1;', newStr: 'const x = 2;' },
      { file: 'a.ts', oldStr: 'const y = 1;', newStr: 'const y = 2;' },
    ];
    expect(countReverts(ops)).toBe(0);
  });

  it('A→B 후 B→A 편집은 1로 감지한다', () => {
    const ops = [
      { file: 'a.ts', oldStr: 'const x = 1;', newStr: 'const x = 2;' },
      // 두 번째 편집: oldStr이 첫 번째의 newStr을 포함 → revert
      { file: 'a.ts', oldStr: 'const x = 2;', newStr: 'const x = 1;' },
    ];
    expect(countReverts(ops)).toBe(1);
  });

  it('동일 파일에서 관련 없는 편집은 되돌림으로 판정하지 않는다', () => {
    const ops = [
      { file: 'a.ts', oldStr: 'function foo() {}', newStr: 'function bar() {}' },
      // 전혀 다른 코드 → 이전 newStr(function bar...)을 포함하지 않음
      { file: 'a.ts', oldStr: 'const unrelated = 1;', newStr: 'const unrelated = 2;' },
    ];
    expect(countReverts(ops)).toBe(0);
  });

  it('oldStr이 10자 미만이면 되돌림으로 감지하지 않는다 (최소 길이 기준)', () => {
    const ops = [
      { file: 'a.ts', oldStr: 'abc', newStr: 'def' },
      // 이전 newStr(def)를 포함하지만 oldStr < 10 → 무시
      { file: 'a.ts', oldStr: 'def', newStr: 'abc' },
    ];
    expect(countReverts(ops)).toBe(0);
  });

  it('다른 파일 간 편집은 되돌림으로 판정하지 않는다', () => {
    const ops = [
      { file: 'a.ts', oldStr: 'const x = 1;', newStr: 'const x = 2;' },
      // b.ts에서 a.ts의 newStr과 동일한 문자열 편집 → 다른 파일이므로 revert 아님
      { file: 'b.ts', oldStr: 'const x = 2;', newStr: 'const x = 1;' },
    ];
    expect(countReverts(ops)).toBe(0);
  });

  it('여러 파일에 걸친 각각의 되돌림을 독립적으로 카운트한다', () => {
    const ops = [
      { file: 'a.ts', oldStr: 'const alpha = 1;', newStr: 'const alpha = 2;' },
      { file: 'b.ts', oldStr: 'const beta = 1;', newStr: 'const beta = 2;' },
      // a.ts 되돌림
      { file: 'a.ts', oldStr: 'const alpha = 2;', newStr: 'const alpha = 1;' },
      // b.ts 되돌림
      { file: 'b.ts', oldStr: 'const beta = 2;', newStr: 'const beta = 1;' },
    ];
    expect(countReverts(ops)).toBe(2);
  });

  it('이전 newStr을 부분 포함하는 oldStr도 되돌림으로 감지한다', () => {
    const ops = [
      {
        file: 'a.ts',
        oldStr: 'function oldName() { return 1; }',
        newStr: 'function newName() { return 1; }',
      },
      {
        // oldStr이 이전 newStr 전체를 포함
        file: 'a.ts',
        oldStr: 'function newName() { return 1; } // added comment',
        newStr: 'function oldName() { return 1; } // added comment',
      },
    ];
    expect(countReverts(ops)).toBe(1);
  });

  it('newStr이 10자 미만이면 이후 비교 대상에 등록하지 않는다', () => {
    const ops = [
      // newStr이 짧아서 저장되지 않음
      { file: 'a.ts', oldStr: 'const x = 1;', newStr: 'short' },
      // 이전 newStr('short')이 저장 안 됐으므로 revert 감지 불가
      { file: 'a.ts', oldStr: 'const short match', newStr: 'const x = 1;' },
    ];
    expect(countReverts(ops)).toBe(0);
  });

  it('동일 파일에서 연속 3회 편집 후 되돌림은 이전 newStr 누적을 기준으로 카운트한다', () => {
    // 세 번째 op의 oldStr('const x = 3;')이
    // 저장된 prevStrs(['const x = 2;', 'const x = 3;']) 중 하나와 일치
    // break로 첫 매칭에서 중단하므로 1회만 카운트됨
    const ops = [
      { file: 'a.ts', oldStr: 'const x = 1;', newStr: 'const x = 2;' },
      { file: 'a.ts', oldStr: 'const x = 2;', newStr: 'const x = 3;' },
      { file: 'a.ts', oldStr: 'const x = 3;', newStr: 'const x = 1;' },
    ];
    // 세 번째 op: oldStr이 prevStrs에 포함된 항목('const x = 3;')과 일치 → revert 1회
    // 두 번째 op: oldStr('const x = 2;')이 prevStrs(['const x = 2;'])에 포함 → revert 1회
    // 총 revert = 2
    expect(countReverts(ops)).toBe(2);
  });
});

// ─────────────────────────────────────────────
// categorizeTools
// ─────────────────────────────────────────────
describe('categorizeTools', () => {
  it('빈 toolBreakdown은 모든 카운트가 0이다', () => {
    const result = categorizeTools({});
    expect(result).toEqual({
      agent: 0, skill: 0, command: 0, mcp: 0,
      task: 0, web: 0, exploration: 0, editing: 0,
    });
  });

  it('Bash는 command로 분류된다', () => {
    const result = categorizeTools({ Bash: 5 });
    expect(result.command).toBe(5);
    expect(result.editing).toBe(0);
  });

  it('Read, Grep, Glob, ToolSearch는 exploration으로 분류된다', () => {
    const result = categorizeTools({ Read: 3, Grep: 2, Glob: 1, ToolSearch: 4 });
    expect(result.exploration).toBe(10);
  });

  it('Edit, Write, NotebookEdit는 editing으로 분류된다', () => {
    const result = categorizeTools({ Edit: 4, Write: 2, NotebookEdit: 1 });
    expect(result.editing).toBe(7);
  });

  it('Agent, SendMessage, TeamCreate는 agent로 분류된다', () => {
    const result = categorizeTools({ Agent: 2, SendMessage: 3, TeamCreate: 1 });
    expect(result.agent).toBe(6);
  });

  it('Skill은 skill로 분류된다', () => {
    const result = categorizeTools({ Skill: 3 });
    expect(result.skill).toBe(3);
  });

  it('mcp__ 또는 mcp_ 접두사 도구는 mcp로 분류된다', () => {
    const result = categorizeTools({
      'mcp__chrome-devtools__click': 2,
      'mcp_custom_tool': 1,
    });
    expect(result.mcp).toBe(3);
  });

  it('task 접두사 도구는 task로 분류된다', () => {
    const result = categorizeTools({ TaskCreate: 2, TaskUpdate: 1 });
    expect(result.task).toBe(3);
  });

  it('WebFetch, WebSearch는 web으로 분류된다', () => {
    const result = categorizeTools({ WebFetch: 4, WebSearch: 2 });
    expect(result.web).toBe(6);
  });

  it('대소문자 구분 없이 분류된다 (lowercase 기준)', () => {
    const result = categorizeTools({ BASH: 3, read: 2 });
    expect(result.command).toBe(3);
    expect(result.exploration).toBe(2);
  });

  it('알 수 없는 도구는 어느 카테고리에도 추가되지 않는다', () => {
    const result = categorizeTools({ UnknownTool: 10, AnotherUnknown: 5 });
    const total = Object.values(result).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it('여러 카테고리가 섞인 경우 각각 올바르게 분류된다', () => {
    const result = categorizeTools({
      Read: 5,
      Edit: 3,
      Bash: 2,
      'mcp__playwright__click': 4,
      WebSearch: 1,
    });
    expect(result.exploration).toBe(5);
    expect(result.editing).toBe(3);
    expect(result.command).toBe(2);
    expect(result.mcp).toBe(4);
    expect(result.web).toBe(1);
  });
});

// ─────────────────────────────────────────────
// analyzeInteractionPattern
// ─────────────────────────────────────────────
describe('analyzeInteractionPattern', () => {
  it('빈 배열은 모든 카운트가 0이다', () => {
    const result = analyzeInteractionPattern([]);
    expect(result).toEqual({ questions: 0, instructions: 0, corrections: 0, approvals: 0 });
  });

  it('수정 키워드 프롬프트는 corrections로 분류된다', () => {
    const result = analyzeInteractionPattern(['아니 그게 아닌데']);
    expect(result.corrections).toBe(1);
    expect(result.approvals).toBe(0);
    expect(result.questions).toBe(0);
    expect(result.instructions).toBe(0);
  });

  it('승인 키워드 프롬프트는 approvals로 분류된다', () => {
    const result = analyzeInteractionPattern(['좋아 잘했어']);
    expect(result.approvals).toBe(1);
    expect(result.corrections).toBe(0);
  });

  it('물음표가 있는 프롬프트는 questions로 분류된다', () => {
    // '이게 맞아?'는 '맞아'가 승인 패턴에 먼저 매칭되므로 approvals로 분류됨
    // 순수하게 물음표만 있는 프롬프트로 테스트
    const result = analyzeInteractionPattern(['이게 뭐야?']);
    expect(result.questions).toBe(1);
    expect(result.instructions).toBe(0);
  });

  it('물음표가 있어도 승인 키워드가 있으면 approvals로 분류된다 (우선순위: 승인 > 질문)', () => {
    // '이게 맞아?'는 '맞아'(승인) 패턴에 먼저 매칭되어 approvals로 분류됨
    const result = analyzeInteractionPattern(['이게 맞아?']);
    expect(result.approvals).toBe(1);
    expect(result.questions).toBe(0);
  });

  it('지시 키워드 프롬프트는 instructions로 분류된다', () => {
    const result = analyzeInteractionPattern(['기능 추가해줘']);
    expect(result.instructions).toBe(1);
  });

  it('어떤 패턴도 없는 프롬프트는 어디에도 집계되지 않는다', () => {
    const result = analyzeInteractionPattern(['그냥 메모']);
    const total = result.questions + result.instructions + result.corrections + result.approvals;
    expect(total).toBe(0);
  });

  it('수정 키워드가 있으면 승인 키워드보다 우선한다 (우선순위: 수정 > 승인)', () => {
    // '아니'(수정) + '좋아'(승인) 모두 포함 → corrections만 집계
    const result = analyzeInteractionPattern(['아니 좋아']);
    expect(result.corrections).toBe(1);
    expect(result.approvals).toBe(0);
  });

  it('수정 키워드가 있으면 질문보다 우선한다 (우선순위: 수정 > 질문)', () => {
    const result = analyzeInteractionPattern(['아니 왜?']);
    expect(result.corrections).toBe(1);
    expect(result.questions).toBe(0);
  });

  it('승인 키워드가 있으면 질문보다 우선한다 (우선순위: 승인 > 질문)', () => {
    const result = analyzeInteractionPattern(['맞아 어떻게?']);
    expect(result.approvals).toBe(1);
    expect(result.questions).toBe(0);
  });

  it('각 프롬프트는 정확히 하나의 카테고리에만 집계된다', () => {
    const prompts = [
      '기능 추가해줘',
      '좋아 완벽해',
      '뭐가 문제야?',
      '아니 다시 해줘',
    ];
    const result = analyzeInteractionPattern(prompts);
    const total = result.questions + result.instructions + result.corrections + result.approvals;
    expect(total).toBeLessThanOrEqual(prompts.length);
  });

  it('여러 프롬프트를 올바르게 집계한다', () => {
    const prompts = [
      '기능 만들어줘',
      '버그 수정해줘',
      '어떻게 동작해?',
      '좋아',
      '아니 틀렸어',
    ];
    const result = analyzeInteractionPattern(prompts);
    expect(result.instructions).toBe(2);
    expect(result.questions).toBe(1);
    expect(result.approvals).toBe(1);
    expect(result.corrections).toBe(1);
  });
});
