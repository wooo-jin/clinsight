import { pathBasename, pathTail } from '../../../shared/lib/format.js';
import { FEATURE_LABELS } from '../../../shared/lib/constants.js';
import type { ParsedSession, SessionAnalysis } from '../../../shared/types/session.js';

export function computeInsights(sessions: ParsedSession[], analyses: SessionAnalysis[]) {
  const avg = (arr: number[]) =>
    arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  const avgFloat = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // 세션 ID → 분석 매핑
  const analysisMap = new Map(analyses.map((a) => [a.sessionId, a]));

  // ── 효율 지표 ──
  const avgFirstTryRate = avg(analyses.map((a) => a.firstTryRate));
  const avgExplorationEff = avg(analyses.map((a) => a.explorationEfficiency));
  const avgChurnIndex = Math.round(avgFloat(analyses.map((a) => a.churnIndex)) * 100) / 100;
  const avgRevertRate = avg(analyses.map((a) => a.revertRate));

  // ── 기능 사용 TOP 5 ──
  const featureTotals: Record<string, number> = {};
  for (const s of sessions) {
    for (const [key, count] of Object.entries(s.featureUsage)) {
      featureTotals[key] = (featureTotals[key] ?? 0) + count;
    }
  }
  const topFeatures = Object.entries(featureTotals)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => [FEATURE_LABELS[key] ?? key, count] as [string, number])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  const maxFeatureCount = topFeatures.length > 0 ? topFeatures[0][1] : 1;

  // ── 시간대별 활동 ──
  const hourlyActivity = new Array(24).fill(0) as number[];
  for (const s of sessions) {
    hourlyActivity[s.startTime.getHours()]++;
  }
  let maxHourly = 0;
  for (const c of hourlyActivity) { if (c > maxHourly) maxHourly = c; }
  const peakHours = hourlyActivity
    .map((count, hour) => ({ count, hour }))
    .filter((h) => h.count >= maxHourly * 0.8 && h.count > 0)
    .map((h) => h.hour);

  const bucketLabels = ['00-03시', '03-06시', '06-09시', '09-12시', '12-15시', '15-18시', '18-21시', '21-24시'];
  const hourlyBuckets = bucketLabels.map((label, bi) => {
    const start = bi * 3;
    return { label, count: hourlyActivity[start] + hourlyActivity[start + 1] + hourlyActivity[start + 2] };
  });
  let maxBucketCount = 1;
  for (const b of hourlyBuckets) { if (b.count > maxBucketCount) maxBucketCount = b.count; }

  // ── 수정-승인 비율 ──
  let totalCorrections = 0;
  let totalApprovals = 0;
  for (const s of sessions) {
    totalCorrections += s.interactionPattern.corrections;
    totalApprovals += s.interactionPattern.approvals;
  }
  const correctionRate = (totalCorrections + totalApprovals) > 0
    ? Math.round((totalCorrections / (totalCorrections + totalApprovals)) * 100)
    : 0;

  // ── Agent 위임 패턴 ──
  const agentTotals: Record<string, number> = {};
  for (const s of sessions) {
    for (const [type, count] of Object.entries(s.agentTypes)) {
      agentTotals[type] = (agentTotals[type] ?? 0) + count;
    }
  }
  const topAgentTypes = Object.entries(agentTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  // ── 세션 길이 ──
  const avgDuration = avg(sessions.map((s) => s.durationMinutes));
  let maxDuration = 0;
  for (const s of sessions) { if (s.durationMinutes > maxDuration) maxDuration = s.durationMinutes; }

  // ── 🆕 프롬프트 패턴 분석 ──
  let totalQuestions = 0;
  let totalInstructions = 0;
  let totalPromptLength = 0;
  let totalPromptCount = 0;
  for (const s of sessions) {
    totalQuestions += s.interactionPattern.questions;
    totalInstructions += s.interactionPattern.instructions;
    for (const p of s.userPrompts) {
      totalPromptLength += p.length;
      totalPromptCount++;
    }
  }
  const avgPromptLength = totalPromptCount > 0 ? Math.round(totalPromptLength / totalPromptCount) : 0;
  const promptBreakdown = {
    questions: totalQuestions,
    instructions: totalInstructions,
    corrections: totalCorrections,
    approvals: totalApprovals,
  };

  // ── 🆕 토큰 효율 ──
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalMessages = 0;
  let totalToolCalls = 0;
  let totalCost = 0;
  for (const s of sessions) {
    totalInput += s.totalInputTokens;
    totalOutput += s.totalOutputTokens;
    totalCacheRead += s.totalCacheReadTokens;
    totalCacheWrite += s.totalCacheWriteTokens;
    totalMessages += s.userMessageCount;
    totalToolCalls += s.toolUseCount;
    totalCost += s.estimatedCostUsd;
  }
  // 캐시 히트율: 전체 프롬프트 토큰(input + cacheRead + cacheWrite) 중 캐시 적중 비율
  // - input_tokens: 캐시 미사용 토큰 (full-price miss)
  // - cache_read_input_tokens: 캐시 적중 토큰 (hit, ~1/10 비용)
  // - cache_creation_input_tokens: 처음 캐시에 쓰인 토큰 (miss, ~1.25x 비용)
  // → cache_creation도 miss이므로 분모에 포함해야 정확한 히트율
  const totalPromptTokens = totalInput + totalCacheRead + totalCacheWrite;
  const cacheHitRate = totalPromptTokens > 0
    ? Math.round((totalCacheRead / totalPromptTokens) * 100)
    : 0;
  const tokensPerMessage = totalMessages > 0 ? Math.round((totalPromptTokens + totalOutput) / totalMessages) : 0;
  const costPerToolCall = totalToolCalls > 0 ? totalCost / totalToolCalls : 0;

  // ── 🆕 반복 편집 핫스팟 ──
  const fileEditTotals: Record<string, number> = {};
  for (const s of sessions) {
    for (const [file, count] of Object.entries(s.repeatedEdits)) {
      const short = pathTail(file, 2);
      fileEditTotals[short] = (fileEditTotals[short] ?? 0) + count;
    }
  }
  const editHotspots = Object.entries(fileEditTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  // ── 🆕 프로젝트별 효율 비교 ──
  const projectStats: Record<string, { efficiency: number[]; cost: number; sessions: number }> = {};
  for (const s of sessions) {
    const name = pathBasename(s.project);
    if (!projectStats[name]) projectStats[name] = { efficiency: [], cost: 0, sessions: 0 };
    projectStats[name].cost += s.estimatedCostUsd;
    projectStats[name].sessions++;
    const a = analysisMap.get(s.sessionId);
    if (a) projectStats[name].efficiency.push(a.efficiencyScore);
  }
  const projectRanking = Object.entries(projectStats)
    .map(([name, data]) => ({
      name,
      avgEfficiency: data.efficiency.length > 0
        ? Math.round(data.efficiency.reduce((a, b) => a + b, 0) / data.efficiency.length)
        : 0,
      cost: data.cost,
      sessions: data.sessions,
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 5);

  // ── 🆕 종합 진단 ──
  const diagnosis: { icon: string; text: string; color: string }[] = [];

  if (avgChurnIndex <= 0.15 && analyses.length > 0) {
    diagnosis.push({ icon: '✓', text: '편집 정확도가 우수합니다', color: 'green' });
  } else if (avgChurnIndex > 0.3) {
    diagnosis.push({ icon: '!', text: `삽질 지수 ${avgChurnIndex} — 요구사항을 더 구체적으로 작성하세요`, color: 'red' });
  }

  if (cacheHitRate >= 60) {
    diagnosis.push({ icon: '✓', text: `캐시 히트율 ${cacheHitRate}% — 토큰 비용이 효율적입니다`, color: 'green' });
  } else if (cacheHitRate < 30 && totalInput > 0) {
    diagnosis.push({ icon: '!', text: `캐시 히트율 ${cacheHitRate}% — 세션을 자주 새로 시작하면 캐시 효과가 떨어집니다`, color: 'yellow' });
  }

  if (correctionRate > 50) {
    diagnosis.push({ icon: '!', text: `수정 요청 ${correctionRate}% — 초기 지시의 구체성을 높이세요`, color: 'red' });
  } else if (correctionRate <= 20 && totalCorrections + totalApprovals > 0) {
    diagnosis.push({ icon: '✓', text: '수정 요청이 적어 프롬프트 품질이 좋습니다', color: 'green' });
  }

  if (avgPromptLength < 30 && totalPromptCount > 5) {
    diagnosis.push({ icon: '△', text: `평균 프롬프트 ${avgPromptLength}자 — 컨텍스트를 더 제공하면 정확도가 올라갑니다`, color: 'yellow' });
  } else if (avgPromptLength > 200) {
    diagnosis.push({ icon: '△', text: `평균 프롬프트 ${avgPromptLength}자 — 핵심만 전달하면 비용을 줄일 수 있습니다`, color: 'yellow' });
  }

  if (topAgentTypes.length === 0 && totalToolCalls > 50) {
    diagnosis.push({ icon: '△', text: 'Agent 위임을 활용하면 복잡한 작업을 병렬화할 수 있습니다', color: 'yellow' });
  }

  if (avgDuration > 60) {
    diagnosis.push({ icon: '!', text: `평균 ${avgDuration}분 — 40분 단위로 끊고 컴팩트하면 성능이 유지됩니다`, color: 'yellow' });
  }

  const totalReverts = sessions.reduce((sum, s) => sum + s.revertCount, 0);
  if (totalReverts > 10) {
    diagnosis.push({ icon: '!', text: `되돌림 ${totalReverts}회 — 수정 전 의도를 명확히 전달하세요`, color: 'red' });
  }

  return {
    avgFirstTryRate, avgExplorationEff, avgChurnIndex, avgRevertRate,
    topFeatures, maxFeatureCount,
    hourlyBuckets, maxBucketCount, peakHours,
    totalCorrections, totalApprovals, correctionRate,
    topAgentTypes,
    avgDuration, maxDuration,
    // 🆕
    promptBreakdown, avgPromptLength, totalPromptCount,
    cacheHitRate, tokensPerMessage, costPerToolCall,
    editHotspots,
    projectRanking,
    diagnosis,
  };
}
