import type {
  ProjectUserMessage,
  ProjectAssistantMessage,
  ContentBlock,
  TokenUsage,
  FeatureUsage,
} from '../../../shared/types/session.js';
import { loadConfig } from '../../../shared/lib/config.js';
import type { PricingEntry } from '../../../shared/lib/config.js';

// 내장 기본 단가 (USD per 1M tokens)
// https://docs.anthropic.com/en/docs/about-claude/models#model-comparison-table
// 긴 키부터 매칭하여 'sonnet-4-6'이 'sonnet-4'보다 먼저 매칭되도록 정렬
const BUILTIN_PRICING: [string, PricingEntry][] = [
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

/** 내장 + config.json 오버라이드를 병합한 가격 테이블 (config 우선) */
function buildPricingEntries(): [string, PricingEntry][] {
  const config = loadConfig();
  if (!config.pricing || Object.keys(config.pricing).length === 0) {
    return BUILTIN_PRICING;
  }
  // config 오버라이드를 긴 키 순으로 정렬하여 앞에 배치
  const overrides: [string, PricingEntry][] = Object.entries(config.pricing)
    .sort(([a], [b]) => b.length - a.length);
  // 내장 목록에서 오버라이드된 키 제거 후 병합
  const overrideKeys = new Set(overrides.map(([k]) => k));
  const remaining = BUILTIN_PRICING.filter(([k]) => !overrideKeys.has(k));
  return [...overrides, ...remaining];
}

// 캐시: 프로세스 수명 동안 한 번만 config 읽기 (매 세션 파싱마다 I/O 방지)
let _pricingCache: [string, PricingEntry][] | null = null;
function getPricingEntries(): [string, PricingEntry][] {
  if (!_pricingCache) _pricingCache = buildPricingEntries();
  return _pricingCache;
}

/** 가격 캐시 초기화 (테스트용) */
export function resetPricingCache(): void { _pricingCache = null; }

/** 모델에 해당하는 가격 정보 조회 (config.json 오버라이드 > 내장 기본값) */
export function getPricing(model: string): PricingEntry {
  return getPricingEntries().find(([key]) => model.includes(key))?.[1] ?? DEFAULT_PRICING;
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

// ── 상호작용 패턴 분류 규칙 (데이터 주도) ──
// 배열 순서 = 우선순위: 앞에 정의된 규칙이 먼저 매칭되면 해당 카테고리로 확정
// 새 패턴 추가 시 이 배열에 항목만 추가하면 됨 (if/else 체인 수정 불필요)
type InteractionCategory = 'corrections' | 'approvals' | 'questions' | 'instructions';

interface ClassificationRule {
  category: InteractionCategory;
  pattern: RegExp;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // ── 수정 (최우선: 사용자가 AI 결과를 거부/수정 요청) ──
  { category: 'corrections', pattern: /아니[, \n]|아니$|아닌데|그게 아니|안 돼|틀렸|잘못|고쳐/i },
  { category: 'corrections', pattern: /다시 ?해줘|다시 ?해주|다시 ?해봐/i },
  { category: 'corrections', pattern: /no[, ]not|wrong|undo|revert|fix that|that's not|try again|instead$/i },
  // ── 승인 ──
  { category: 'approvals', pattern: /좋아|맞아|응|네|ㅇㅇ|감사|고마워|잘했|완벽/i },
  { category: 'approvals', pattern: /looks good|lgtm|perfect|great|thanks|nice|correct|yes/i },
  // ── 질문 ──
  { category: 'questions', pattern: /\?/ },
  { category: 'questions', pattern: /뭐|어떻게|왜|what|how|why|where|which|can you|could you|is there/i },
  // ── 지시 (최저 우선순위) ──
  { category: 'instructions', pattern: /해줘|만들어|추가|수정|삭제|변경|구현|작성|알려줘|보여줘|설명해/i },
  { category: 'instructions', pattern: /add|create|remove|delete|change|update|implement|write|build|make/i },
];

/** 사용자 상호작용 패턴 분석
 *  규칙 배열을 순회하여 첫 매칭 카테고리로 분류 (우선순위 = 배열 순서) */
export function analyzeInteractionPattern(
  userPrompts: string[],
): { questions: number; instructions: number; corrections: number; approvals: number } {
  const result = { questions: 0, instructions: 0, corrections: 0, approvals: 0 };
  for (const prompt of userPrompts) {
    for (const rule of CLASSIFICATION_RULES) {
      if (rule.pattern.test(prompt)) {
        result[rule.category]++;
        break;
      }
    }
  }
  return result;
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
