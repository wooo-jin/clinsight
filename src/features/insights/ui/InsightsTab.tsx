import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Panel, Bar } from '../../../shared/ui/index.js';
import { padEnd, formatTokens } from '../../../shared/lib/format.js';
import type { ParsedSession, SessionAnalysis } from '../../../shared/types/session.js';
import { computeInsights } from '../lib/compute-insights.js';

interface InsightsTabProps {
  sessions: ParsedSession[];
  analyses: SessionAnalysis[];
}

export function InsightsTab({ sessions, analyses }: InsightsTabProps) {
  const ins = useMemo(() => computeInsights(sessions, analyses), [sessions, analyses]);

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        {/* 효율 지표 */}
        <Panel title="📊 효율 지표">
          <Box flexDirection="column">
            <Box>
              <Text>삽질 지수    </Text>
              <Text color={ins.avgChurnIndex > 0.3 ? 'red' : 'green'}>
                {ins.avgChurnIndex.toFixed(2)}
              </Text>
              <Text dimColor> 되돌림/편집 비율</Text>
            </Box>
            <Box>
              <Text>1회 해결률   </Text>
              <Bar value={ins.avgFirstTryRate} width={15} />
              <Text dimColor> 첫 편집으로 완료</Text>
            </Box>
            <Box>
              <Text>탐색 효율    </Text>
              <Bar value={ins.avgExplorationEff} width={15} />
              <Text dimColor> 읽기→편집 전환율</Text>
            </Box>
            <Box>
              <Text>되돌림 비율  </Text>
              <Bar value={ins.avgRevertRate} width={15} colorThresholds={{ green: 20, yellow: 40 }} />
              <Text dimColor> 이전 편집 취소 비율</Text>
            </Box>
          </Box>
        </Panel>

        {/* 토큰 효율 */}
        <Panel title="💎 토큰 효율">
          <Box>
            <Text>캐시 히트율  </Text>
            <Bar value={ins.cacheHitRate} width={15} />
          </Box>
          <Text>메시지당 토큰  <Text color="cyan">{formatTokens(ins.tokensPerMessage)}</Text></Text>
          <Text>도구 호출당 비용  <Text color="yellow">${ins.costPerToolCall.toFixed(3)}</Text></Text>
          {ins.cacheHitRate < 30 && ins.tokensPerMessage > 0 && (
            <Text color="yellow" dimColor>
              캐시율 낮음 → 세션 유지/resume 활용 권장
            </Text>
          )}
        </Panel>
      </Box>

      <Box gap={2}>
        {/* 프롬프트 패턴 */}
        <Panel title="💬 프롬프트 패턴">
          <Text>총 {ins.totalPromptCount}개 | 평균 <Text color="cyan">{ins.avgPromptLength}자</Text></Text>
          <Box marginTop={1} flexDirection="column">
            {([
              ['📝 지시', ins.promptBreakdown.instructions, 'cyan'],
              ['❓ 질문', ins.promptBreakdown.questions, 'blue'],
              ['🔄 수정', ins.promptBreakdown.corrections, 'yellow'],
              ['✅ 승인', ins.promptBreakdown.approvals, 'green'],
            ] as const).map(([label, count, color]) => {
              const total = ins.totalPromptCount || 1;
              const barLen = Math.min(20, Math.round((count / total) * 20));
              return (
                <Box key={label}>
                  <Text>{padEnd(label, 10)}</Text>
                  <Text color={color}>{'█'.repeat(barLen)}</Text>
                  <Text dimColor> {count}</Text>
                </Box>
              );
            })}
          </Box>
          {ins.correctionRate > 50 && (
            <Text color="yellow">수정 비율 {ins.correctionRate}% → 지시를 구체적으로</Text>
          )}
        </Panel>

        {/* 기능 사용 TOP 5 */}
        <Panel title="🛠️ 기능 사용 TOP 5">
          {ins.topFeatures.map(([name, count]) => (
            <Box key={name}>
              <Text>{padEnd(name, 14)}</Text>
              <Text color="cyan">{'█'.repeat(Math.min(20, Math.round((count / ins.maxFeatureCount) * 20)))}</Text>
              <Text> {count}</Text>
            </Box>
          ))}
        </Panel>
      </Box>

      <Box gap={2}>
        {/* 반복 편집 핫스팟 */}
        <Panel title="🔥 반복 편집 핫스팟">
          {ins.editHotspots.length === 0 ? (
            <Text dimColor>반복 편집된 파일 없음 — 깔끔합니다!</Text>
          ) : (
            ins.editHotspots.map(([file, count]) => (
              <Box key={file}>
                <Text color={count >= 6 ? 'red' : 'yellow'}>
                  {padEnd(file, 30)} {count}회
                </Text>
              </Box>
            ))
          )}
        </Panel>

        {/* Agent 위임 패턴 */}
        <Panel title="🤖 Agent 위임 패턴">
          {ins.topAgentTypes.length === 0 ? (
            <Text dimColor>Agent 사용 기록 없음</Text>
          ) : (
            ins.topAgentTypes.map(([type, count]) => (
              <Box key={type}>
                <Text>{padEnd(type, 16)}</Text>
                <Text color="cyan">{count}회</Text>
              </Box>
            ))
          )}
        </Panel>
      </Box>

      <Box gap={2}>
        {/* 시간대별 세션 분포 */}
        <Panel title="🕐 시간대별 세션 분포">
          {ins.hourlyBuckets.map((bucket) => (
            <Box key={bucket.label}>
              <Text>{padEnd(bucket.label, 10)}</Text>
              <Text color={bucket.count === ins.maxBucketCount ? 'cyan' : 'gray'}>
                {'█'.repeat(Math.min(20, Math.round((bucket.count / ins.maxBucketCount) * 20)))}
              </Text>
              <Text> {bucket.count}</Text>
            </Box>
          ))}
          {ins.peakHours.length > 0 && (
            <Text dimColor>피크: {ins.peakHours.map((h) => `${h}시`).join(', ')}</Text>
          )}
        </Panel>

        {/* 프로젝트별 효율 */}
        <Panel title="📂 프로젝트별 효율">
          {ins.projectRanking.length === 0 ? (
            <Text dimColor>데이터 없음</Text>
          ) : (
            ins.projectRanking.map((p) => (
              <Box key={p.name}>
                <Text>{padEnd(p.name, 24)}</Text>
                <Text color={p.avgEfficiency >= 70 ? 'green' : p.avgEfficiency >= 50 ? 'yellow' : 'red'}>
                  {p.avgEfficiency}/100
                </Text>
                <Text dimColor> {p.sessions}세션 ${p.cost.toFixed(1)}</Text>
              </Box>
            ))
          )}
        </Panel>
      </Box>

      {/* 세션 길이 분석 */}
      <Panel title="⏱️ 세션 길이 분석">
        <Text>평균: {ins.avgDuration}분 | 최장: {ins.maxDuration}분</Text>
        {ins.avgDuration > 45 && (
          <Text color="yellow">평균 {ins.avgDuration}분 — 40분 단위 세션 권장</Text>
        )}
      </Panel>

      {/* 종합 진단 */}
      {ins.diagnosis.length > 0 && (
        <Panel title="🩺 종합 진단">
          {ins.diagnosis.map((d, i) => (
            <Text key={i} color={d.color as 'red' | 'green' | 'yellow'}>
              {d.icon} {d.text}
            </Text>
          ))}
        </Panel>
      )}
    </Box>
  );
}
