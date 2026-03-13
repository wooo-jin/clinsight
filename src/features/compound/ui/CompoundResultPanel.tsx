import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Panel } from '../../../shared/ui/index.js';
import type { CompoundResult, AppliedCompoundItem } from '../../../shared/types/session.js';
import { findAppliedItem } from '../lib/applied-items.js';
import type { ListItem } from '../lib/compound-results.js';

/** 대상 CLAUDE.md에서 Compound Insights 섹션 추출 */
function getCompoundSection(target: string): string[] {
  const mdPath = target === 'global'
    ? join(homedir(), '.claude', 'CLAUDE.md')
    : join(target, '.claude', 'CLAUDE.md');

  if (!existsSync(mdPath)) return [];

  const content = readFileSync(mdPath, 'utf-8');
  const sectionStart = content.indexOf('## Compound Insights');
  if (sectionStart === -1) return [];

  const afterSection = content.slice(sectionStart);
  const nextH2 = afterSection.slice(1).search(/\n## [^#]/);
  const section = nextH2 !== -1 ? afterSection.slice(0, nextH2 + 1) : afterSection;

  return section.split('\n').filter((l) => l.trim()).slice(0, 15); // 최대 15줄
}

/** useMemo 래퍼: 렌더링 중 파일 I/O를 캐싱 */
function useCompoundSection(target: string, enabled: boolean): string[] {
  return useMemo(() => {
    if (!enabled) return [];
    return getCompoundSection(target);
  }, [target, enabled]);
}

type ApplyMode = 'none' | 'selectTarget' | 'history';

interface CompoundResultPanelProps {
  latest: CompoundResult | undefined;
  results: CompoundResult[];
  /** 이력 관리용 전체 결과 (필터 미적용) */
  allResults?: CompoundResult[];
  actionItems: ListItem[];
  insightItems: ListItem[];
  applied: AppliedCompoundItem[];
  safeCursor: number;
  selectableIndices: number[];
  applyMode: ApplyMode;
  targets: { label: string; value: string }[];
  targetCursor: number;
  historyCursor: number;
  isRunning: boolean;
  statusMsg: string;
}

export function CompoundResultPanel({
  latest,
  results,
  allResults,
  actionItems,
  insightItems,
  applied,
  safeCursor,
  selectableIndices,
  applyMode,
  targets,
  targetCursor,
  historyCursor,
  isRunning,
  statusMsg,
}: CompoundResultPanelProps) {
  const renderItem = (item: ListItem, globalIdx: number, _i: number, _section: string) => {
    if (item.isHeader) {
      return <Text key={`h-${globalIdx}`} bold color="cyan">{item.label}</Text>;
    }
    const selIdx = selectableIndices.indexOf(globalIdx);
    const isSelected = selIdx === safeCursor && applyMode === 'none';
    const existing = findAppliedItem(applied, item.type, item.text);
    const statusIcon = existing
      ? existing.status === 'applied' ? '✓' : '✗'
      : '○';
    const statusColor = existing
      ? existing.status === 'applied' ? 'green' : 'red'
      : 'gray';

    return (
      <Box key={`i-${globalIdx}`}>
        <Text wrap="truncate" color={isSelected ? 'cyan' : undefined} bold={isSelected} inverse={isSelected}>
          {isSelected ? '▸' : ' '} <Text color={statusColor}>{statusIcon}</Text> {item.text}
        </Text>
      </Box>
    );
  };

  const currentTarget = targets[targetCursor]?.value ?? 'global';
  const compoundSectionLines = useCompoundSection(currentTarget, applyMode === 'selectTarget');

  return (
    <>
      <Panel title="📦 컴파운드 현황">
        {latest ? (
          <>
            <Text wrap="truncate">마지막 실행: {latest.date} ✓</Text>
            {latest.sessionCount != null && (
              <Text wrap="truncate" dimColor>
                조회 세션: {latest.sessionCount}개
                {latest.dateRange ? ` | ${latest.dateRange.from} ~ ${latest.dateRange.to}` : ''}
              </Text>
            )}
            {latest.classification && (
              <>
                <Text wrap="truncate">요약: <Text color="cyan">{latest.classification.summary}</Text></Text>
                <Text wrap="truncate" dimColor>
                  유형: {latest.classification.types.join(', ')} | 도메인: {latest.classification.domains.join(', ')} | 복잡도: {latest.classification.complexity}
                </Text>
              </>
            )}
            <Text wrap="truncate">
              예방규칙: {latest.preventionRules?.length ?? 0}개 | 패턴: {latest.patterns.length}개 | 솔루션: {latest.solutions.length}개 | 컨벤션: {latest.conventions.length}개
            </Text>
          </>
        ) : (
          <Text dimColor>
            {(allResults ?? results).length > 0
              ? '선택한 기간에 실행된 컴파운드 결과가 없습니다.'
              : '아직 컴파운드를 실행한 적이 없습니다.'}
          </Text>
        )}
      </Panel>

      {/* 적용 가능한 규칙 (CLAUDE.md에 추가) */}
      {actionItems.length > 0 && (
        <Panel title={`✅ CLAUDE.md에 추가할 규칙 (${actionItems.filter((x) => !x.isHeader).length}개)`}>
          {actionItems.map((item, i) => renderItem(item, i, i, 'action'))}
          <Text dimColor>[a] 무시하지 않은 항목 전체 CLAUDE.md에 적용</Text>
        </Panel>
      )}

      {/* 참고용 인사이트 (읽기 전용) */}
      {insightItems.length > 0 && (
        <Panel title={`📖 사용 패턴 인사이트 (${insightItems.filter((x) => !x.isHeader).length}개)`}>
          {insightItems.map((item, i) => {
            if (item.isHeader) {
              return <Text key={`ih-${i}`} bold color="cyan">{item.label}</Text>;
            }
            return <Text key={`ii-${i}`} wrap="truncate" dimColor>  {item.text}</Text>;
          })}
        </Panel>
      )}

      {/* 적용 대상 선택 모달 */}
      {applyMode === 'selectTarget' && (
        <>
          <Panel title="📍 CLAUDE.md 적용 대상 선택">
            <Text dimColor>무시하지 않은 항목을 모두 어디에 추가할까요?</Text>
            {targets.map((t, i) => (
              <Box key={t.value}>
                <Text color={i === targetCursor ? 'cyan' : undefined} bold={i === targetCursor} inverse={i === targetCursor}>
                  {i === targetCursor ? '▸' : ' '} {t.label}
                </Text>
              </Box>
            ))}
            <Text dimColor>[j/k] 이동  [Enter] 선택  [Esc] 취소</Text>
          </Panel>
          <Panel title="📄 현재 Compound Insights">
            {compoundSectionLines.length === 0
              ? <Text dimColor>(아직 적용된 규칙 없음)</Text>
              : compoundSectionLines.map((line, i) => (
                <Text key={i} wrap="truncate" dimColor={!line.startsWith('###')}>
                  {line}
                </Text>
              ))}
          </Panel>
        </>
      )}

      {/* 이력 관리 모드 */}
      {applyMode === 'history' && (
        <Panel title="📜 이력 관리 — 삭제할 항목 선택">
          {(allResults ?? results).map((r, i) => {
            const selected = i === historyCursor;
            const summary = r.classification?.summary
              ? ` — ${r.classification.summary.slice(0, 40)}`
              : '';
            return (
              <Box key={i}>
                <Text
                  wrap="truncate"
                  color={selected ? 'cyan' : undefined}
                  bold={selected}
                  inverse={selected}
                >
                  {selected ? '▸' : ' '} {r.date}{summary}
                  {' | '}패턴 {r.patterns.length} | 솔루션 {r.solutions.length} | 컨벤션 {r.conventions.length}
                  {r.sessionCount != null ? ` | ${r.sessionCount}세션` : ''}
                </Text>
              </Box>
            );
          })}
          <Text dimColor>[j/k] 이동  [x] 삭제  [Esc] 돌아가기</Text>
        </Panel>
      )}

      {/* 히스토리 요약 (일반 모드) */}
      {applyMode === 'none' && results.length > 1 && (
        <Panel title="📜 실행 이력">
          {results.slice(0, 5).map((r, i) => (
            <Text key={i} wrap="truncate" dimColor={i > 0}>
              {r.date} | 패턴 {r.patterns.length} | 솔루션 {r.solutions.length} |
              컨벤션 {r.conventions.length}
            </Text>
          ))}
        </Panel>
      )}

      {isRunning && (
        <Text color="yellow" bold>⏳ 컴파운드 분석 실행 중... (Claude Sonnet 호출 중)</Text>
      )}

      {statusMsg && <Text color="green" bold>{statusMsg}</Text>}
    </>
  );
}
