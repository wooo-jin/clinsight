import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Panel, SparkLine } from '../../../shared/ui/index.js';
import { padEnd, formatTokens, pathBasename } from '../../../shared/lib/format.js';
import { ANALYSIS } from '../../../shared/lib/constants.js';
import type { ParsedSession, SessionAnalysis } from '../../../shared/types/session.js';
import { format } from 'date-fns';

interface CostTabProps {
  sessions: ParsedSession[];
  analyses: SessionAnalysis[];
}

export function CostTab({ sessions, analyses }: CostTabProps) {
  const cost = useMemo(() => computeCost(sessions, analyses), [sessions, analyses]);

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Panel title="💰 비용 요약">
          <Text>이번 달 총: <Text bold color="yellow">${cost.monthTotal.toFixed(2)}</Text></Text>
          <Text>일 평균: ${cost.dailyAvg.toFixed(2)}</Text>
          <Text>세션당 평균: ${cost.perSession.toFixed(2)}</Text>
          <Text>총 토큰: {formatTokens(cost.monthTokens)}</Text>
        </Panel>

        <Panel title="💡 절약 가능 분석">
          {cost.savingsCompact > 0 && (
            <Text>컴팩트 최적화: <Text color="green">-${cost.savingsCompact.toFixed(2)}</Text></Text>
          )}
          {cost.savingsExploration > 0 && (
            <Text>불필요 탐색 절감: <Text color="green">-${cost.savingsExploration.toFixed(2)}</Text></Text>
          )}
          {cost.totalSavings > 0 ? (
            <Text bold>
              예상 절약: <Text color="green">${cost.totalSavings.toFixed(2)}/월</Text>
            </Text>
          ) : (
            <Text dimColor>절약 가능한 항목이 없습니다.</Text>
          )}
        </Panel>
      </Box>

      <Panel title="📊 일별 비용 (최근 14일)">
        <SparkLine data={cost.dailyCosts} color="yellow" />
        <Box>
          {cost.dailyLabels.map((label: string, i: number) => (
            <Text key={i} dimColor>{label} </Text>
          ))}
        </Box>
      </Panel>

      <Box gap={2}>
        <Panel title="🏷️ 모델별 비용">
          {cost.modelBreakdown.map(([model, data]: [string, { cost: number; tokens: number }]) => (
            <Box key={model}>
              <Text>{padEnd(model, 22)}</Text>
              <Text color="yellow">${data.cost.toFixed(2)}</Text>
              <Text dimColor> ({formatTokens(data.tokens)})</Text>
            </Box>
          ))}
        </Panel>

        <Panel title="📂 프로젝트별 비용 TOP 5">
          {cost.projectBreakdown.slice(0, 5).map(([project, data]: [string, { cost: number; sessions: number }]) => (
            <Box key={project}>
              <Text>{padEnd(project, 28)}</Text>
              <Text color="yellow">${data.cost.toFixed(2)}</Text>
              <Text dimColor> ({data.sessions}세션)</Text>
            </Box>
          ))}
        </Panel>
      </Box>
    </Box>
  );
}

function computeCost(sessions: ParsedSession[], analyses: SessionAnalysis[]) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthSessions = sessions.filter((s) => s.startTime >= monthStart);

  const monthTotal = monthSessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0);
  const monthTokens = monthSessions.reduce(
    (sum, s) => sum + s.totalInputTokens + s.totalOutputTokens, 0,
  );
  const daysInMonth = Math.max(1, now.getDate());

  // 14일간 일별 데이터
  const dailyCosts: number[] = [];
  const dailyLabels: string[] = [];
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let i = 13; i >= 0; i--) {
    const dayStart = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const daySessions = sessions.filter(
      (s) => s.startTime >= dayStart && s.startTime < dayEnd,
    );
    dailyCosts.push(daySessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0));
    dailyLabels.push(format(dayStart, 'dd'));
  }

  // 모델별 분류
  const modelData: Record<string, { cost: number; tokens: number }> = {};
  for (const s of sessions) {
    const model = s.model || 'unknown';
    if (!modelData[model]) modelData[model] = { cost: 0, tokens: 0 };
    modelData[model].cost += s.estimatedCostUsd;
    modelData[model].tokens += s.totalInputTokens + s.totalOutputTokens;
  }
  const modelBreakdown = Object.entries(modelData).sort(([, a], [, b]) => b.cost - a.cost);

  // 프로젝트별 분류
  const projectData: Record<string, { cost: number; sessions: number }> = {};
  for (const s of sessions) {
    const projectName = pathBasename(s.project);
    if (!projectData[projectName]) projectData[projectName] = { cost: 0, sessions: 0 };
    projectData[projectName].cost += s.estimatedCostUsd;
    projectData[projectName].sessions++;
  }
  const projectBreakdown = Object.entries(projectData).sort(([, a], [, b]) => b.cost - a.cost);

  // 절약 가능 추정
  const monthAnalyses = analyses.filter((a) =>
    monthSessions.some((s) => s.sessionId === a.sessionId),
  );
  const savingsCompact = monthAnalyses.reduce((sum, a) => {
    return sum + a.suggestions
      .filter((s) => s.type === 'compact' && s.tokensSaveable)
      .reduce((s2, sug) => s2 + (sug.tokensSaveable ?? 0) * ANALYSIS.TOKEN_TO_USD_FACTOR, 0);
  }, 0);
  const savingsExploration = monthAnalyses.reduce((sum, a) => {
    return sum + a.suggestions
      .filter((s) => (s.type === 'efficiency' || s.type === 'agent') && s.tokensSaveable)
      .reduce((s2, sug) => s2 + (sug.tokensSaveable ?? 0) * ANALYSIS.TOKEN_TO_USD_FACTOR, 0);
  }, 0);

  return {
    monthTotal,
    monthTokens,
    dailyAvg: monthTotal / daysInMonth,
    perSession: monthSessions.length > 0 ? monthTotal / monthSessions.length : 0,
    dailyCosts,
    dailyLabels,
    modelBreakdown,
    projectBreakdown,
    savingsCompact,
    savingsExploration,
    totalSavings: savingsCompact + savingsExploration,
  };
}

