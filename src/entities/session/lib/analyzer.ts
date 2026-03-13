import type {
  ParsedSession,
  SessionAnalysis,
  Suggestion,
} from '../../../shared/types/session.js';
import { pathBasename, pathTail } from '../../../shared/lib/format.js';
import { ANALYSIS, getContextWindowSize } from '../../../shared/lib/constants.js';

/** 세션 효율성 분석 */
export function analyzeSession(session: ParsedSession): SessionAnalysis {
  const suggestions: Suggestion[] = [];

  // 세션 식별용 라벨: "~경로 HH:MM"
  const projectPath = pathBasename(session.project);
  const timeStr = `${session.startTime.getHours().toString().padStart(2, '0')}:${session.startTime.getMinutes().toString().padStart(2, '0')}`;
  const label = `[${projectPath} ${timeStr}]`;

  // 1. 삽질 지수: 되돌림(revert) 기반
  //    같은 파일을 여러 번 편집하는 것은 점진적 개발일 수 있으므로 삽질이 아님
  //    되돌림(이전 변경을 취소하는 편집)만이 진짜 삽질
  //    분모: 성공 편집(unique files) + 되돌림 횟수 = 전체 편집 노력
  const successEdits = session.filesEdited.length;
  const totalEffort = successEdits + session.revertCount;
  const churnIndex = totalEffort > 0
    ? session.revertCount / totalEffort
    : 0;

  // 반복 편집 경고 (높은 임계치에서만 — 과도한 반복은 여전히 비효율 신호)
  for (const [file, count] of Object.entries(session.repeatedEdits)) {
    if (count >= ANALYSIS.REPEATED_EDIT_CRITICAL) {
      const shortFile = pathTail(file, 2);
      suggestions.push({
        type: 'efficiency',
        severity: 'warning',
        message: `${shortFile}를 ${count}회 수정 — 되돌림이 포함되었는지 확인`,
        tokensSaveable: Math.round(count * ANALYSIS.TOKENS_PER_REPEATED_EDIT),
      });
    }
  }

  // 되돌림 경고 (진짜 삽질 탐지)
  if (session.revertCount >= 3) {
    suggestions.push({
      type: 'efficiency',
      severity: session.revertCount >= 5 ? 'critical' : 'warning',
      message: `${label} ${session.revertCount}회 되돌림 → 요구사항 명확화 또는 단계별 접근 권장`,
      tokensSaveable: session.revertCount * ANALYSIS.TOKENS_PER_REPEATED_EDIT,
    });
  }

  // 2. 탐색 효율: 읽은 파일 중 편집에 기여한 비율
  //    편집이 없는 세션(코드 리뷰, 디버깅, 아키텍처 파악 등)은
  //    탐색 자체가 목적이므로 별도 처리
  const isExplorationOnly = session.filesEdited.length === 0;
  const readButNotEdited = session.filesRead.filter(
    (f) => !session.filesEdited.includes(f),
  );
  const explorationEfficiency = isExplorationOnly
    ? 100 // 탐색 전용 세션은 읽기 자체가 목적
    : session.filesRead.length > 0
      ? Math.min(100, Math.round(
          ((session.filesRead.length - readButNotEdited.length) / session.filesRead.length) * 100,
        ))
      : 100;

  // 편집이 있는 세션에서만 불필요 탐색 경고 생성
  if (!isExplorationOnly
    && readButNotEdited.length > ANALYSIS.UNUSED_READ_WARNING
    && readButNotEdited.length / session.filesEdited.length > 5) {
    suggestions.push({
      type: 'agent',
      severity: 'warning',
      message: `${readButNotEdited.length}개 파일을 읽었지만 편집하지 않음 → Agent 위임 고려`,
      tokensSaveable: readButNotEdited.length * ANALYSIS.TOKENS_PER_UNUSED_READ,
    });
  }

  // 3. 세션 길이 경고
  if (session.durationMinutes > ANALYSIS.SESSION_DURATION_WARNING) {
    suggestions.push({
      type: 'compact',
      severity: 'warning',
      message: `${label} ${session.durationMinutes}분 진행 → 40-50분 단위 세션 권장`,
    });
  }

  // 4. 컨텍스트 포화도 (모델별 컨텍스트 윈도우 크기 기반)
  const peakContext = session.peakContextTokens;
  const contextWindow = getContextWindowSize(session.model);
  const contextWarning = Math.round(contextWindow * 0.75);
  const contextCritical = Math.round(contextWindow * 0.9);
  const contextSaturation = Math.min(
    100,
    Math.round((peakContext / contextWindow) * 100),
  );

  if (peakContext > contextWarning) {
    const severity = peakContext > contextCritical ? 'critical' : 'warning';
    suggestions.push({
      type: 'compact',
      severity,
      message: `${label} 컨텍스트 ${Math.round(peakContext / 1000)}K/${Math.round(contextWindow / 1000)}K → 컴팩트 권장`,
      tokensSaveable: Math.round(peakContext * 0.3),
    });
  }

  // 5. 1회 해결률: 전체 편집 노력 중 되돌림 없이 완료된 비율
  const firstTryRate = totalEffort > 0
    ? Math.round((successEdits / totalEffort) * 100)
    : 100;

  // 6. 되돌림 비율
  const revertRate = totalEffort > 0
    ? Math.round((session.revertCount / totalEffort) * 100)
    : 0;

  // 7. 비용 경고
  if (session.estimatedCostUsd > ANALYSIS.SESSION_COST_WARNING) {
    suggestions.push({
      type: 'efficiency',
      severity: session.estimatedCostUsd > ANALYSIS.SESSION_COST_CRITICAL ? 'critical' : 'warning',
      message: `${label} $${session.estimatedCostUsd.toFixed(2)} → 범위 축소 또는 모델 변경 고려`,
    });
  }

  // 8. 효율 점수 계산
  const efficiencyScore = calculateEfficiencyScore({
    firstTryRate,
    churnIndex,
    explorationEfficiency,
    contextSaturation,
    durationMinutes: session.durationMinutes,
  });

  return {
    sessionId: session.sessionId,
    efficiencyScore,
    firstTryRate,
    churnIndex: Math.round(churnIndex * 100) / 100,
    revertRate,
    explorationEfficiency,
    contextSaturation,
    suggestions,
  };
}

function calculateEfficiencyScore(params: {
  firstTryRate: number;
  churnIndex: number;
  explorationEfficiency: number;
  contextSaturation: number;
  durationMinutes: number;
}): number {
  const {
    firstTryRate,
    churnIndex,
    explorationEfficiency,
    contextSaturation,
    durationMinutes,
  } = params;

  let score = 50;

  score += (firstTryRate / 100) * 25;
  score -= Math.min(20, churnIndex * 40);
  score += (explorationEfficiency / 100) * 15;

  if (contextSaturation > 80) {
    score -= (contextSaturation - 80) * 0.5;
  }

  if (durationMinutes > ANALYSIS.SESSION_DURATION_WARNING) {
    score -= Math.min(10, (durationMinutes - ANALYSIS.SESSION_DURATION_WARNING) / 10);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
