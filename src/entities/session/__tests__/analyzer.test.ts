import { describe, it, expect } from 'vitest';
import { analyzeSession } from '../lib/analyzer.js';
import type { ParsedSession } from '../../../shared/types/session.js';

function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    sessionId: 'test-session',
    project: '/test/project',
    startTime: new Date('2026-03-10T10:00:00Z'),
    endTime: new Date('2026-03-10T10:30:00Z'),
    durationMinutes: 30,
    userMessageCount: 5,
    toolUseCount: 20,
    toolBreakdown: { read: 10, edit: 5, grep: 3, bash: 2 },
    filesRead: ['a.ts', 'b.ts', 'c.ts'],
    filesEdited: ['a.ts', 'b.ts'],
    repeatedEdits: {},
    totalInputTokens: 50_000,
    totalOutputTokens: 10_000,
    totalCacheReadTokens: 20_000,
    totalCacheWriteTokens: 5_000,
    model: 'claude-opus-4-6',
    estimatedCostUsd: 1.5,
    peakContextTokens: 70_000,
    userPrompts: ['기능 추가해줘', '버그 수정해줘'],
    featureUsage: {
      agent: 0, skill: 0, command: 2, mcp: 0,
      task: 0, web: 0, exploration: 13, editing: 5,
    },
    revertCount: 0,
    interactionPattern: {
      questions: 0,
      instructions: 2,
      corrections: 0,
      approvals: 0,
    },
    agentTypes: {},
    editOps: [],
    ...overrides,
  };
}

describe('analyzeSession', () => {
  it('정상 세션에 대해 유효한 분석 결과를 반환한다', () => {
    const session = makeSession();
    const result = analyzeSession(session);

    expect(result.sessionId).toBe('test-session');
    expect(result.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(result.efficiencyScore).toBeLessThanOrEqual(100);
    expect(result.firstTryRate).toBe(100); // 반복 편집 없으므로 100%
    expect(result.churnIndex).toBe(0);
    expect(result.revertRate).toBe(0);
  });

  it('되돌림이 있으면 삽질 지수가 올라간다', () => {
    const session = makeSession({
      revertCount: 2,
      filesEdited: ['a.ts', 'b.ts'],
    });
    const result = analyzeSession(session);

    // totalEffort = 2(files) + 2(reverts) = 4, churnIndex = 2/4 = 0.5
    expect(result.churnIndex).toBe(0.5);
    expect(result.firstTryRate).toBe(50); // 2/4 = 50%
    expect(result.revertRate).toBe(50);
  });

  it('반복 편집만으로는 삽질이 아니다 (되돌림 없음)', () => {
    const session = makeSession({
      repeatedEdits: { 'a.ts': 6, 'b.ts': 4 },
      revertCount: 0,
    });
    const result = analyzeSession(session);

    expect(result.churnIndex).toBe(0);
    expect(result.firstTryRate).toBe(100);
    expect(result.revertRate).toBe(0);
  });

  it('되돌림이 많으면 경고를 생성한다', () => {
    const session = makeSession({
      revertCount: 5,
      filesEdited: ['a.ts', 'b.ts', 'c.ts'],
    });
    const result = analyzeSession(session);

    expect(result.suggestions.some((s) => s.type === 'efficiency' && s.severity === 'critical')).toBe(true);
  });

  it('60분 이상 세션에 경고를 생성한다', () => {
    const session = makeSession({ durationMinutes: 90 });
    const result = analyzeSession(session);

    expect(result.suggestions.some((s) => s.type === 'compact' && s.message.includes('90분'))).toBe(true);
  });

  it('피크 컨텍스트가 150K 이상이면 컴팩트 제안을 한다', () => {
    const session = makeSession({
      peakContextTokens: 160_000,
    });
    const result = analyzeSession(session);

    // 160K / 200K = 80%
    expect(result.contextSaturation).toBe(80);
    expect(result.suggestions.some((s) => s.type === 'compact')).toBe(true);
  });

  it('피크 컨텍스트가 180K 이상이면 심각 경고를 생성한다', () => {
    const session = makeSession({
      peakContextTokens: 195_000,
    });
    const result = analyzeSession(session);

    // 195K / 200K = 97.5% → 98%
    expect(result.contextSaturation).toBe(98);
    expect(result.suggestions.some((s) =>
      s.type === 'compact' && s.severity === 'critical',
    )).toBe(true);
  });

  it('비용이 높으면 경고를 생성한다', () => {
    const session = makeSession({ estimatedCostUsd: 35 });
    const result = analyzeSession(session);

    expect(result.suggestions.some((s) =>
      s.type === 'efficiency' && s.severity === 'critical',
    )).toBe(true);
  });

  it('불필요한 파일 읽기가 많으면 Agent 위임을 제안한다', () => {
    const session = makeSession({
      filesRead: Array.from({ length: 15 }, (_, i) => `file${i}.ts`),
      filesEdited: ['file0.ts'],
    });
    const result = analyzeSession(session);

    expect(result.suggestions.some((s) => s.type === 'agent')).toBe(true);
  });

  it('편집 파일이 없으면 firstTryRate 100%', () => {
    const session = makeSession({
      filesEdited: [],
      repeatedEdits: {},
    });
    const result = analyzeSession(session);

    expect(result.firstTryRate).toBe(100);
    expect(result.revertRate).toBe(0);
  });

  it('효율 점수가 0~100 범위 안에 있다', () => {
    // 최악의 세션
    const worst = makeSession({
      revertCount: 10,
      durationMinutes: 300,
      totalInputTokens: 500_000,
      totalCacheReadTokens: 500_000,
      estimatedCostUsd: 20,
    });
    const worstResult = analyzeSession(worst);
    expect(worstResult.efficiencyScore).toBeGreaterThanOrEqual(0);

    // 최고의 세션
    const best = makeSession({
      repeatedEdits: {},
      durationMinutes: 10,
      totalInputTokens: 1_000,
      totalCacheReadTokens: 0,
    });
    const bestResult = analyzeSession(best);
    expect(bestResult.efficiencyScore).toBeLessThanOrEqual(100);
  });

  it('낮은 피크 컨텍스트에서는 포화도가 낮다', () => {
    const session = makeSession({
      peakContextTokens: 70_000,
    });
    const result = analyzeSession(session);

    // 70K / 200K = 35%
    expect(result.contextSaturation).toBe(35);
    expect(result.suggestions.some((s) => s.type === 'compact' && s.message.includes('컨텍스트'))).toBe(false);
  });
});
