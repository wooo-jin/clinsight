import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Panel, SparkLine } from '../../../shared/ui/index.js';
import { formatTokens } from '../../../shared/lib/format.js';
import { FEATURE_LABELS } from '../../../shared/lib/constants.js';
import { severityRank, severityColor, severityIcon } from '../../../shared/lib/severity.js';
import type { ParsedSession, SessionAnalysis, Suggestion } from '../../../shared/types/session.js';

interface DashboardTabProps {
  sessions: ParsedSession[];
  analyses: SessionAnalysis[];
}

export function DashboardTab({ sessions, analyses }: DashboardTabProps) {
  const stats = useMemo(() => computeStats(sessions, analyses), [sessions, analyses]);

  return (
    <Box flexDirection="column" gap={1}>
      {/* 기간별 요약 — 각 패널에 고정 width */}
      <Box gap={1}>
        <Panel title="📊 오늘" width={26}>
          <Text wrap="truncate">세션: {stats.today.count}</Text>
          <Text wrap="truncate">토큰: {formatTokens(stats.today.tokens)}</Text>
          <Text wrap="truncate">비용: ${stats.today.cost.toFixed(2)}</Text>
          <Text wrap="truncate">효율: {stats.today.avgEfficiency}/100</Text>
        </Panel>
        <Panel title="📊 이번 주" width={26}>
          <Text wrap="truncate">세션: {stats.week.count}</Text>
          <Text wrap="truncate">토큰: {formatTokens(stats.week.tokens)}</Text>
          <Text wrap="truncate">비용: ${stats.week.cost.toFixed(2)}</Text>
          <Text wrap="truncate">효율: {stats.week.avgEfficiency}/100</Text>
        </Panel>
        <Panel title="📊 이번 달" width={26}>
          <Text wrap="truncate">세션: {stats.month.count}</Text>
          <Text wrap="truncate">토큰: {formatTokens(stats.month.tokens)}</Text>
          <Text wrap="truncate">비용: ${stats.month.cost.toFixed(2)}</Text>
          <Text wrap="truncate">효율: {stats.month.avgEfficiency}/100</Text>
        </Panel>
      </Box>

      {/* 추이 그래프 — 세로 배치 */}
      <Box flexDirection="column" gap={1}>
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

      {/* 시간대별 활동 — 세로 배치 (24칸은 가로로 두 패널 못 담음) */}
      <Panel title="🕐 시간대별 활동 (오늘)">
        <HourlyHeatmap data={stats.hourlyCosts} />
      </Panel>

      {/* 주간 요일별 사용량 */}
      <Panel title="📅 주간 요일별 사용량">
        <SparkLine
          data={stats.weekdayCosts}
          color="yellow"
          formatValue={(v) => `$${v.toFixed(0)}`}
          labels={['월', '화', '수', '목', '금', '토', '일']}
        />
        <Box>
          <Text dimColor>세션: </Text>
          {stats.weekdaySessions.map((count: number, i: number) => (
            <Box key={i} width={10} justifyContent="center">
              <Text dimColor>{count}개</Text>
            </Box>
          ))}
        </Box>
      </Panel>

      {/* 기능 사용 현황 — flexWrap으로 줄바꿈 허용 */}
      <Panel title="🛠️ 기능 사용 현황 (전체)">
        <Box flexWrap="wrap" columnGap={2}>
          {stats.featureRanking.map(([label, count]: [string, number]) => (
            <Text key={label} wrap="truncate">
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
            <Text key={i} wrap="truncate" color={severityColor(s.severity)}>
              {severityIcon(s.severity)} {s.message}
              {s.tokensSaveable ? ` (토큰 ~${formatTokens(s.tokensSaveable)} 절약)` : ''}
            </Text>
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

  // 시간대별 비용 (오늘, 0-23시)
  const hourlyCosts = new Array(24).fill(0) as number[];
  const todaySessions = sessions.filter((s) => s.startTime >= todayStart);
  for (const s of todaySessions) {
    const hour = s.startTime.getHours();
    hourlyCosts[hour] += s.estimatedCostUsd;
  }

  // 주간 요일별 비용/세션 (최근 7일, 월=0 ~ 일=6)
  const weekdayCosts = new Array(7).fill(0) as number[];
  const weekdaySessions = new Array(7).fill(0) as number[];
  const weekSessions = sessions.filter((s) => s.startTime >= weekStart);
  for (const s of weekSessions) {
    const jsDay = s.startTime.getDay();
    const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
    weekdayCosts[dayIdx] += s.estimatedCostUsd;
    weekdaySessions[dayIdx]++;
  }

  return {
    today: periodStats(todayStart),
    week: periodStats(weekStart),
    month: periodStats(monthStart),
    dailyCosts,
    dailyEfficiency,
    hourlyCosts,
    weekdayCosts,
    weekdaySessions,
    topSuggestions,
    featureRanking,
  };
}

const HEAT_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function HourlyHeatmap({ data }: { data: number[] }) {
  const max = Math.max(...data, 0.01);
  // 6시간씩 4그룹으로 나눠서 표시 (가독성 향상)
  const groups = [
    { label: '새벽', range: [0, 5] },
    { label: '오전', range: [6, 11] },
    { label: '오후', range: [12, 17] },
    { label: '저녁', range: [18, 23] },
  ];

  return (
    <Box flexDirection="column">
      <Box>
        {data.map((v, i) => {
          const idx = Math.round((v / max) * (HEAT_BLOCKS.length - 1));
          const color = v === 0 ? 'gray' : v >= max * 0.7 ? 'red' : v >= max * 0.3 ? 'yellow' : 'green';
          return (
            <Text key={i} color={color}>{HEAT_BLOCKS[idx]} </Text>
          );
        })}
      </Box>
      <Box>
        {data.map((_, i) => (
          <Text key={i} dimColor>{String(i).padStart(2)} </Text>
        ))}
      </Box>
      <Box marginTop={1} gap={2}>
        {groups.map((g) => {
          const sum = data.slice(g.range[0], g.range[1] + 1).reduce((a, b) => a + b, 0);
          return (
            <Text key={g.label} dimColor>
              {g.label} ${sum.toFixed(1)}
            </Text>
          );
        })}
        <Text dimColor>| 피크: {data.indexOf(Math.max(...data))}시</Text>
      </Box>
    </Box>
  );
}

