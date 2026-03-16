import type {
  ProjectUserMessage,
  ProjectAssistantMessage,
  ContentBlock,
  TokenUsage,
  FeatureUsage,
} from '../../../shared/types/session.js';

// 모델별 토큰 단가 (USD per 1M tokens)
// https://docs.anthropic.com/en/docs/about-claude/models#model-comparison-table
// 긴 키부터 매칭하여 'sonnet-4-6'이 'sonnet-4'보다 먼저 매칭되도록 정렬
type PricingEntry = { input: number; output: number; cacheRead: number; cacheWrite: number };
const PRICING_ENTRIES: [string, PricingEntry][] = [
  ['opus-4-6',    { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ['sonnet-4-6',  { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['haiku-4-5',   { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }],
  ['opus-4',      { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ['sonnet-4',    { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['haiku-4',     { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }],
  ['sonnet-3-5',  { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['haiku-3-5',   { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 }],
];

const DEFAULT_PRICING: PricingEntry = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

/** 모델에 해당하는 가격 정보 조회 (긴 키부터 매칭하여 오매칭 방지) */
export function getPricing(model: string): PricingEntry {
  return PRICING_ENTRIES.find(([key]) => model.includes(key))?.[1] ?? DEFAULT_PRICING;
}

/** 비용 계산 */
export function calculateCost(usage: TokenUsage, model: string): number {
  const pricing = getPricing(model);

  const inputCost = ((usage.input_tokens ?? 0) / 1_000_000) * pricing.input;
  const outputCost = ((usage.output_tokens ?? 0) / 1_000_000) * pricing.output;
  const cacheReadCost = ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * pricing.cacheRead;
  const cacheWriteCost = ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * pricing.cacheWrite;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

/** 사용자 메시지에서 프롬프트 텍스트 추출 */
export function extractUserPrompt(msg: ProjectUserMessage): string {
  const content = msg.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

/** assistant content에서 tool_use 블록 추출 */
export function extractToolUses(msg: ProjectAssistantMessage): { name: string; input: Record<string, unknown> }[] {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];

  return content
    .filter((b): b is ContentBlock & { name: string } => b.type === 'tool_use' && typeof b.name === 'string')
    .map((b) => ({ name: b.name, input: b.input ?? {} }));
}

/** 도구 호출을 고수준 기능 카테고리로 분류 */
export function categorizeTools(toolBreakdown: Record<string, number>): FeatureUsage {
  const usage: FeatureUsage = {
    agent: 0, skill: 0, command: 0, mcp: 0,
    task: 0, web: 0, exploration: 0, editing: 0,
  };

  for (const [name, count] of Object.entries(toolBreakdown)) {
    const lower = name.toLowerCase();
    if (lower === 'agent' || lower === 'sendmessage' || lower === 'teamcreate') {
      usage.agent += count;
    } else if (lower === 'skill') {
      usage.skill += count;
    } else if (lower === 'bash') {
      usage.command += count;
    } else if (lower.startsWith('mcp__') || lower.startsWith('mcp_')) {
      usage.mcp += count;
    } else if (lower.startsWith('task')) {
      usage.task += count;
    } else if (lower === 'webfetch' || lower === 'websearch') {
      usage.web += count;
    } else if (lower === 'read' || lower === 'grep' || lower === 'glob' || lower === 'toolsearch') {
      usage.exploration += count;
    } else if (lower === 'edit' || lower === 'write' || lower === 'notebookedit') {
      usage.editing += count;
    }
  }

  return usage;
}

// 한/영 이중 지원 패턴
const CORRECTION_PATTERN = /아니[, \n]|아니$|아닌데|그게 아니|안 돼|틀렸|잘못|고쳐|다시 ?해줘|다시 ?해주|다시 ?해봐|no[, ]not|wrong|undo|revert|fix that|that's not|try again|instead/i;
const APPROVAL_PATTERN = /좋아|맞아|응|네|ㅇㅇ|감사|고마워|잘했|완벽|looks good|lgtm|perfect|great|thanks|nice|correct|yes/i;
const QUESTION_PATTERN = /뭐|어떻게|왜|what|how|why|where|which|can you|could you|is there/i;
const INSTRUCTION_PATTERN = /해줘|만들어|추가|수정|삭제|변경|구현|작성|add|create|remove|delete|change|update|implement|write|build|make/i;

/** 사용자 상호작용 패턴 분석 (우선순위: 수정 > 승인 > 질문 > 지시) */
export function analyzeInteractionPattern(
  userPrompts: string[],
): { questions: number; instructions: number; corrections: number; approvals: number } {
  const pattern = { questions: 0, instructions: 0, corrections: 0, approvals: 0 };
  for (const prompt of userPrompts) {
    // 우선순위 기반 분류 (각 프롬프트는 하나의 카테고리에만 집계)
    if (CORRECTION_PATTERN.test(prompt)) {
      pattern.corrections++;
    } else if (APPROVAL_PATTERN.test(prompt)) {
      pattern.approvals++;
    } else if (prompt.includes('?') || QUESTION_PATTERN.test(prompt)) {
      pattern.questions++;
    } else if (INSTRUCTION_PATTERN.test(prompt)) {
      pattern.instructions++;
    }
  }
  return pattern;
}

/** 되돌림 감지에서 prev가 oldStr에 대해 차지해야 하는 최소 비율.
 *  낮추면 감지 민감도 증가(거짓양성 위험), 높이면 실제 revert 놓칠 가능성 */
const REVERT_COVERAGE_THRESHOLD = 0.5;

/** 되돌림 감지: 나중 편집의 old_string이 이전 편집의 new_string을 포함
 *  거짓양성 방지: prev가 oldStr 길이의 50% 이상을 차지해야 revert로 판정 */
export function countReverts(editOps: { file: string; oldStr: string; newStr: string }[]): number {
  let revertCount = 0;
  // 파일별로 이전 newStr들을 그룹핑하여 탐색 범위 축소
  const prevNewStrsByFile = new Map<string, string[]>();

  for (const op of editOps) {
    if (op.oldStr.length >= 10) {
      const prevStrs = prevNewStrsByFile.get(op.file);
      if (prevStrs) {
        for (const prev of prevStrs) {
          // 부분 매칭 + 최소 커버리지: 단순 코드 확장을 revert로 오판하지 않음
          if (op.oldStr.includes(prev) && prev.length >= op.oldStr.length * REVERT_COVERAGE_THRESHOLD) {
            revertCount++;
            break;
          }
        }
      }
    }
    // 현재 op의 newStr을 이후 비교를 위해 기록
    if (op.newStr.length >= 10) {
      let arr = prevNewStrsByFile.get(op.file);
      if (!arr) {
        arr = [];
        prevNewStrsByFile.set(op.file, arr);
      }
      arr.push(op.newStr);
    }
  }
  return revertCount;
}
