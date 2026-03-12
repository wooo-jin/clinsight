// Projects JSONL 메시지 타입 (실제 ~/.claude/projects/ 구조)
export interface ProjectUserMessage {
  type: 'user';
  timestamp: string;
  sessionId: string;
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
  uuid: string;
  cwd?: string;
  gitBranch?: string;
}

export interface ProjectAssistantMessage {
  type: 'assistant';
  timestamp: string;
  sessionId: string;
  message: {
    model: string;
    role: 'assistant';
    content: ContentBlock[];
    usage: TokenUsage;
    stop_reason?: string;
  };
  uuid: string;
  cwd?: string;
}

export interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text?: string;
  thinking?: string;
  name?: string; // tool_use
  input?: Record<string, unknown>; // tool_use
  id?: string;
  content?: string | ContentBlock[]; // tool_result
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// 파싱 가능한 메시지 타입
export type ProjectMessage = ProjectUserMessage | ProjectAssistantMessage | { type: string };

// history.jsonl
export interface HistoryEntry {
  display: string;
  pastedContents?: Record<string, unknown>;
  timestamp: number;
  project: string;
  sessionId: string;
}

// 파싱된 세션 데이터
export interface ParsedSession {
  sessionId: string;
  project: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  userMessageCount: number;
  toolUseCount: number;
  toolBreakdown: Record<string, number>;
  filesRead: string[];
  filesEdited: string[];
  repeatedEdits: Record<string, number>;
  // 토큰/비용 (실제 데이터)
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  model: string;
  estimatedCostUsd: number;
  /** 단일 메시지 기준 최대 컨텍스트 크기 (input + cache_read + cache_write) */
  peakContextTokens: number;
  // 사용자 프롬프트 원문
  userPrompts: string[];
  // 고수준 기능 사용 현황
  featureUsage: FeatureUsage;
  /** 되돌림 횟수 (이전 편집을 취소하는 편집 수) */
  revertCount: number;
  /** 사용자 상호작용 패턴 */
  interactionPattern: {
    questions: number;      // 질문 (? 포함)
    instructions: number;   // 지시 (해줘, 만들어, etc.)
    corrections: number;    // 수정 요청 (아니, 다시, 틀렸 etc.)
    approvals: number;      // 승인 (좋아, 맞아, 응 etc.)
  };
  /** Agent 위임 타입별 횟수 */
  agentTypes: Record<string, number>;
  /** 편집 작업 목록 (compound 분석용, 최대 20개) */
  editOps: { file: string; oldStr: string; newStr: string }[];
}

/** Claude Code 고수준 기능 사용 현황 */
export interface FeatureUsage {
  /** Agent/팀/병렬 위임 */
  agent: number;
  /** Skill 호출 */
  skill: number;
  /** Bash 커맨드 실행 */
  command: number;
  /** MCP 서버 도구 */
  mcp: number;
  /** Task 관리 (TaskCreate 등) */
  task: number;
  /** 웹 검색/페치 */
  web: number;
  /** 파일 탐색 (Read, Grep, Glob) */
  exploration: number;
  /** 파일 편집 (Edit, Write) */
  editing: number;
}

// 분석 결과
export interface SessionAnalysis {
  sessionId: string;
  efficiencyScore: number;
  firstTryRate: number;
  churnIndex: number;
  revertRate: number;
  explorationEfficiency: number;
  contextSaturation: number;
  suggestions: Suggestion[];
}

export interface Suggestion {
  type: 'compact' | 'prompt' | 'agent' | 'efficiency';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  detail?: string;
  tokensSaveable?: number;
}

// 일별 요약
export interface DailySummary {
  date: string;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgEfficiency: number;
  topTools: [string, number][];
  suggestions: Suggestion[];
}

// 컴파운드 결과
export interface CompoundResult {
  date: string;
  patterns: string[];
  solutions: string[];
  conventions: string[];
  goldenPrompts: GoldenPrompt[];
  /** 예방 규칙 (CLAUDE.md에 추가할 수 있는 구체적 규칙) */
  preventionRules?: PreventionRule[];
  /** 세션 분류 메타 */
  classification?: CompoundClassification;
  /** 분석에 사용된 세션 수 */
  sessionCount?: number;
  /** 분석 대상 기간 */
  dateRange?: { from: string; to: string };
}

export interface PreventionRule {
  category: 'claude-md' | 'lint' | 'type' | 'test' | 'convention';
  rule: string;
  reason: string;
  /** 이 규칙이 적용되는 범위 */
  scope?: 'global' | string; // 'global' 또는 프로젝트 경로
}

export interface CompoundClassification {
  types: string[];      // feature, bugfix, refactor, etc.
  domains: string[];    // 프로젝트/도메인 영역
  complexity: 'low' | 'medium' | 'high';
  summary: string;      // 1-2문장 요약
}

export interface GoldenPrompt {
  prompt: string;
  sessionId: string;
  result: string;
  filesCreated: number;
  retriesNeeded: number;
}

/** 컴파운드 결과에서 적용/무시된 개별 항목 */
export interface AppliedCompoundItem {
  type: 'pattern' | 'solution' | 'convention' | 'goldenPrompt' | 'preventionRule';
  text: string;
  status: 'applied' | 'dismissed';
  date: string;
}
