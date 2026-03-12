import type { ParsedSession } from '../../../shared/types/session.js';
import { analyzeSession } from './analyzer.js';

/** 세션 목록을 Claude에게 보낼 요약 텍스트로 변환 (범용 — 레포 비종속) */
export function formatSessionForCompound(
  sessions: ParsedSession[],
  analyses: ReturnType<typeof analyzeSession>[],
): string {
  const lines: string[] = [];

  // 전체 통계 요약
  const totalSessions = sessions.length;
  const totalDuration = sessions.reduce((s, x) => s + x.durationMinutes, 0);
  const totalCost = sessions.reduce((s, x) => s + x.estimatedCostUsd, 0);
  const avgEfficiency = Math.round(analyses.reduce((s, a) => s + a.efficiencyScore, 0) / totalSessions);
  const totalReverts = sessions.reduce((s, x) => s + x.revertCount, 0);
  const totalEdits = sessions.reduce((s, x) => s + x.featureUsage.editing, 0);
  const totalCorrections = sessions.reduce((s, x) => s + x.interactionPattern.corrections, 0);

  lines.push(`## 전체 요약`);
  lines.push(`- 세션 ${totalSessions}개 | 총 ${totalDuration}분 | 비용 $${totalCost.toFixed(2)}`);
  lines.push(`- 평균 효율: ${avgEfficiency}/100 | 총 되돌림: ${totalReverts}회/${totalEdits}편집 | 수정요청: ${totalCorrections}회`);
  lines.push('');

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const a = analyses[i];
    lines.push(`## 세션 ${i + 1}`);
    lines.push(`- 시간: ${s.durationMinutes}분 | 모델: ${s.model}`);
    lines.push(`- 도구 호출: ${s.toolUseCount}회 | 효율: ${a.efficiencyScore}/100 | 삽질 지수: ${a.churnIndex}`);
    lines.push(`- 1회 해결률: ${a.firstTryRate}% | 되돌림: ${s.revertCount}회`);
    lines.push(`- 기능 사용: Agent ${s.featureUsage.agent}, 편집 ${s.featureUsage.editing}, 탐색 ${s.featureUsage.exploration}, 커맨드 ${s.featureUsage.command}`);

    // 상호작용 패턴
    const ip = s.interactionPattern;
    if (ip.corrections > 0 || ip.approvals > 0 || ip.questions > 0) {
      lines.push(`- 상호작용: 지시 ${ip.instructions}, 질문 ${ip.questions}, 수정요청 ${ip.corrections}, 승인 ${ip.approvals}`);
    }

    // 반복 편집 — 파일 수만 (경로 비노출)
    const repeatedCount = Object.keys(s.repeatedEdits).length;
    if (repeatedCount > 0) {
      const maxRepeats = Math.max(...Object.values(s.repeatedEdits));
      lines.push(`- ⚠ 반복 편집: ${repeatedCount}개 파일 (최대 ${maxRepeats}회)`);
    }

    // 사용자 프롬프트 (민감 정보 마스킹)
    if (s.userPrompts.length > 0) {
      lines.push('- 주요 프롬프트:');
      for (const prompt of s.userPrompts.slice(0, 5)) {
        lines.push(`  - "${redactSensitive(prompt.slice(0, 200))}"`);
      }
    }

    // 제안 사항
    if (a.suggestions.length > 0) {
      lines.push('- 분석기 제안:');
      for (const sug of a.suggestions.slice(0, 3)) {
        lines.push(`  - [${sug.severity}] ${sug.message}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/** Claude에게 보낼 최종 프롬프트 생성 */
export function buildCompoundPrompt(summaryData: string): string {
  return `당신은 Claude Code 활용 패턴 분석 전문가입니다.
다음은 사용자의 Claude Code 세션 분석 데이터입니다. 프로젝트/레포와 무관하게 "Claude Code를 더 잘 쓰는 법"에 집중해서 분석하세요.

${summaryData}

다음 항목을 JSON 형식으로 응답하세요. 모든 텍스트는 한글로 작성하세요.
**중요: 특정 프로젝트/레포/파일명에 종속된 내용은 제외하세요. 어떤 프로젝트에서든 적용 가능한 범용적인 인사이트만 추출하세요.**

{
  "classification": {
    "types": ["feature", "bugfix", "refactor" 등 해당하는 작업 유형들],
    "domains": ["작업 성격 — 예: UI, 백엔드, 인프라, 리팩토링 등"],
    "complexity": "low|medium|high",
    "summary": "오늘 작업의 핵심 요약 (1-2문장, 프로젝트명 없이)"
  },
  "patterns": [
    "Claude Code 사용 습관에서 발견된 패턴. 예: '큰 작업을 한 번에 지시하는 경향', 'Agent 활용 빈도가 낮음' 등"
  ],
  "solutions": [
    "Claude Code를 더 효과적으로 쓰는 팁. 예: '복잡한 작업은 단계별로 나누어 지시하면 되돌림이 줄어든다' 등"
  ],
  "conventions": [
    "CLAUDE.md에 넣으면 좋을 범용 규칙. 예: '파일 수정 전 반드시 Read로 현재 상태 확인', '300줄 이상 파일은 분리' 등"
  ],
  "preventionRules": [
    {
      "category": "claude-md|convention",
      "rule": "CLAUDE.md에 복사-붙여넣기 가능한 구체적 규칙 (프로젝트 비종속)",
      "reason": "이 규칙이 예방하는 실수 유형"
    }
  ],
  "goldenPrompts": [
    {
      "prompt": "효과적이었던 프롬프트 (구체적 파일명 제거, 패턴만 추출)",
      "result": "이 프롬프트가 효과적이었던 이유"
    }
  ]
}

분석 시 다음에 집중하세요:
1. **프롬프트 품질**: 어떤 프롬프트가 1회 해결로 이어졌고, 어떤 게 수정요청/되돌림을 유발했는가
2. **도구 활용**: Agent, 탐색, 편집 비율에서 개선할 점. 탐색 대비 편집 비율이 적절한가
3. **작업 흐름**: 삽질 지수, 되돌림 패턴에서 발견되는 비효율. 어떻게 줄일 수 있는가
4. **상호작용 패턴**: 수정요청이 많다면 초기 지시를 어떻게 개선할 수 있는가

JSON만 응답하세요.`;
}

/** 민감 정보 마스킹 (API 키, 토큰, 비밀번호, URL 자격증명 등) */
function redactSensitive(text: string): string {
  return text
    // API 키/토큰 패턴 (sk-, ghp_, xoxb-, Bearer 등)
    .replace(/(?:sk-|ghp_|xoxb-|xoxp-|glpat-|AKIA)[A-Za-z0-9_\-]{10,}/g, '[REDACTED_KEY]')
    // Bearer 토큰
    .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, 'Bearer [REDACTED]')
    // 일반 비밀번호/시크릿 패턴 (key=..., password=..., secret=..., token=...)
    .replace(/(?:password|secret|token|api_key|apikey|access_key)\s*[=:]\s*\S+/gi, '[REDACTED_CREDENTIAL]')
    // URL 내 자격증명 (https://user:pass@host)
    .replace(/:\/\/[^:]+:[^@]+@/g, '://[REDACTED]@');
}
