import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Panel, SparkLine } from '../../../shared/ui/index.js';
import { formatTokens } from '../../../shared/lib/format.js';
import { FEATURE_LABELS } from '../../../shared/lib/constants.js';
import type { ParsedSession, SessionAnalysis, Suggestion } from '../../../shared/types/session.js';

interface DashboardTabProps {
  sessions: ParsedSession[];
  analyses: SessionAnalysis[];
}

export function DashboardTab({ sessions, analyses }: DashboardTabProps) {
  const stats = useMemo(() => computeStats(sessions, analyses), [sessions, analyses]);

  return (
    <Box flexDirection="column" gap={1}>
      {/* 기간별 요약 */}
      <Box gap={2}>
        <Panel title="📊 오늘">
          <Text>세션: {stats.today.count}</Text>
          <Text>토큰: {formatTokens(stats.today.tokens)}</Text>
          <Text>비용: ${stats.today.cost.toFixed(2)}</Text>
          <Text>효율: {stats.today.avgEfficiency}/100</Text>
        </Panel>
        <Panel title="📊 이번 주">
          <Text>세션: {stats.week.count}</Text>
          <Text>토큰: {formatTokens(stats.week.tokens)}</Text>
          <Text>비용: ${stats.week.cost.toFixed(2)}</Text>
          <Text>효율: {stats.week.avgEfficiency}/100</Text>
        </Panel>
        <Panel title="📊 이번 달">
          <Text>세션: {stats.month.count}</Text>
          <Text>토큰: {formatTokens(stats.month.tokens)}</Text>
          <Text>비용: ${stats.month.cost.toFixed(2)}</Text>
          <Text>효율: {stats.month.avgEfficiency}/100</Text>
        </Panel>
      </Box>

      {/* 추이 그래프 */}
      <Box gap={2}>
        <Panel title="🔥 7일 비용 추이">
          <SparkLine
            data={stats.dailyCosts}
            formatValue={(v) => `$${v.toFixed(0)}`}
          />
        </Panel>
        <Panel title="📈 7일 효율 추이">
          <SparkLine
            data={stats.dailyEfficiency}
            color="green"
            formatValue={(v) => String(v)}
          />
        </Panel>
      </Box>

      {/* 기능 사용 현황 */}
      <Panel title="🛠️ 기능 사용 현황 (전체)">
        <Box gap={3}>
          {stats.featureRanking.map(([label, count]: [string, number]) => (
            <Text key={label}>
              <Text bold color="cyan">{label}</Text>
              <Text dimColor> {count}회</Text>
            </Text>
          ))}
        </Box>
      </Panel>

      {/* 개선 제안 */}
      {stats.topSuggestions.length > 0 && (
        <Panel title="💡 개선 제안">
          {stats.topSuggestions.map((s: Suggestion, i: number) => (
            <Box key={i}>
              <Text color={severityColor(s.severity)}>
                {severityIcon(s.severity)} {s.message}
              </Text>
              {s.tokensSaveable && (
                <Text dimColor> (토큰 ~{formatTokens(s.tokensSaveable)} 절약 가능)</Text>
              )}
            </Box>
          ))}
        </Panel>
      )}
    </Box>
  );
}

interface PeriodStats {
  count: number;
  tokens: number;
  cost: number;
  avgEfficiency: number;
}

function computeStats(sessions: ParsedSession[], analyses: SessionAnalysis[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 세션 ID → 분석 결과 매핑 (O(n) 사전 구축)
  const analysisMap = new Map(analyses.map((a) => [a.sessionId, a]));

  const periodStats = (start: Date): PeriodStats => {
    const filtered = sessions.filter((s) => s.startTime >= start);
    const filteredAnalyses = filtered
      .map((s) => analysisMap.get(s.sessionId))
      .filter((a): a is SessionAnalysis => a !== undefined);

    return {
      count: filtered.length,
      tokens: filtered.reduce((sum, s) =>
        sum + s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheWriteTokens, 0),
      cost: filtered.reduce((sum, s) => sum + s.estimatedCostUsd, 0),
      avgEfficiency: filteredAnalyses.length > 0
        ? Math.round(
            filteredAnalyses.reduce((sum, a) => sum + a.efficiencyScore, 0) /
            filteredAnalyses.length,
          )
        : 0,
    };
  };

  // 7일간 일별 데이터
  const dailyCosts: number[] = [];
  const dailyEfficiency: number[] = [];

  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const daySessions = sessions.filter(
      (s) => s.startTime >= dayStart && s.startTime < dayEnd,
    );
    const dayAnalyses = daySessions
      .map((s) => analysisMap.get(s.sessionId))
      .filter((a): a is SessionAnalysis => a !== undefined);

    dailyCosts.push(daySessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0));
    dailyEfficiency.push(
      dayAnalyses.length > 0
        ? Math.round(
            dayAnalyses.reduce((sum, a) => sum + a.efficiencyScore, 0) /
            dayAnalyses.length,
          )
        : 0,
    );
  }

  // 모든 제안 수집 (동일 메시지 중복 제거)
  const allSuggestions = analyses.flatMap((a) => a.suggestions);
  const seen = new Set<string>();
  const topSuggestions = allSuggestions
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .filter((s) => {
      if (seen.has(s.message)) return false;
      seen.add(s.message);
      return true;
    })
    .slice(0, 5);

  // 기능 사용 현황 집계
  const featureTotals: Record<string, number> = {};
  for (const s of sessions) {
    for (const [key, count] of Object.entries(s.featureUsage)) {
      featureTotals[key] = (featureTotals[key] ?? 0) + count;
    }
  }
  const featureRanking = Object.entries(featureTotals)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => [FEATURE_LABELS[key] ?? key, count] as [string, number])
    .sort(([, a], [, b]) => b - a);

  return {
    today: periodStats(todayStart),
    week: periodStats(weekStart),
    month: periodStats(monthStart),
    dailyCosts,
    dailyEfficiency,
    topSuggestions,
    featureRanking,
  };
}

function severityRank(s: Suggestion['severity']): number {
  return s === 'critical' ? 3 : s === 'warning' ? 2 : 1;
}

function severityColor(s: Suggestion['severity']): string {
  return s === 'critical' ? 'red' : s === 'warning' ? 'yellow' : 'blue';
}

function severityIcon(s: Suggestion['severity']): string {
  return s === 'critical' ? '🔴' : s === 'warning' ? '🟡' : '🔵';
}

