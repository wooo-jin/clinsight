import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CompoundResult, AppliedCompoundItem } from '../../../shared/types/session.js';
import { loadAppliedItems, saveAppliedItems, findAppliedItem } from '../lib/applied-items.js';
import { appendToClaudeMd, listProjectClaudeMdPaths } from '../lib/claude-md-updater.js';
import { pathBasename } from '../../../shared/lib/format.js';
import {
  loadCompoundResults,
  saveCompoundResults,
  buildActionItems,
  buildInsightItems,
  type ListItem,
} from '../lib/compound-results.js';
import { CompoundResultPanel } from './CompoundResultPanel.js';
import { PERIOD_LABELS, PERIOD_ORDER, getPeriodRange } from '../../../shared/lib/period.js';
import type { CompoundPeriod } from '../../../shared/lib/period.js';

export type { CompoundPeriod } from '../../../shared/lib/period.js';

type ApplyMode = 'none' | 'selectTarget' | 'history';

interface CompoundTabProps {
  onRunCompound?: (period: CompoundPeriod) => void;
  isRunning?: boolean;
  /** 세션에서 추출한 프로젝트 경로 목록 */
  projects?: string[];
}

export function CompoundTab({ onRunCompound, isRunning = false, projects = [] }: CompoundTabProps) {
  const [results, setResults] = useState<CompoundResult[]>(() => loadCompoundResults());
  const [applied, setApplied] = useState<AppliedCompoundItem[]>(() => loadAppliedItems());
  const [cursor, setCursor] = useState(0);
  const [applyMode, setApplyMode] = useState<ApplyMode>('none');
  const [targetCursor, setTargetCursor] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [period, setPeriod] = useState<CompoundPeriod>('today');
  const [historyCursor, setHistoryCursor] = useState(0);
  const prevRunning = useRef(isRunning);

  useEffect(() => {
    if (prevRunning.current && !isRunning) {
      setResults(loadCompoundResults());
    }
    prevRunning.current = isRunning;
  }, [isRunning]);

  // 선택된 기간에 해당하는 결과만 필터링 (분석 대상 세션의 dateRange 기준)
  const filteredResults = useMemo(() => {
    const range = getPeriodRange(period);
    if (!range) return results; // 'all'

    return results.filter((r) => {
      if (!r.dateRange) {
        // dateRange 없으면 실행일(date) 기준 fallback
        const resultDate = new Date(r.date);
        if (range.end) return resultDate >= range.start && resultDate < range.end;
        return resultDate >= range.start;
      }
      // dateRange의 from~to가 선택 기간과 겹치는지 확인
      const rangeFrom = new Date(r.dateRange.from);
      const rangeTo = new Date(r.dateRange.to);
      if (range.end) {
        return rangeFrom < range.end && rangeTo >= range.start;
      }
      return rangeTo >= range.start;
    });
  }, [results, period]);

  const latest = filteredResults[0];
  const actionItems = useMemo(() => buildActionItems(latest), [latest]);
  const insightItems = useMemo(() => buildInsightItems(latest), [latest]);
  const selectableIndices = useMemo(
    () => actionItems.map((_, i) => i).filter((i) => !actionItems[i].isHeader),
    [actionItems],
  );

  // 적용 대상 목록: 글로벌 + 프로젝트들
  const targets = useMemo(() => {
    const list: { label: string; value: string }[] = [
      { label: `글로벌 (~/.claude/CLAUDE.md)`, value: 'global' },
    ];
    const projectPaths = listProjectClaudeMdPaths(projects);
    for (const p of projectPaths.slice(0, 8)) {
      const short = pathBasename(p.project);
      const tag = p.exists ? '' : ' (신규)';
      list.push({ label: `${short}${tag}`, value: p.project });
    }
    return list;
  }, [projects]);

  useInput((input, key) => {
    // 적용 대상 선택 모드
    if (applyMode === 'selectTarget') {
      if (key.escape || input === 'q') { setApplyMode('none'); return; }
      if (key.upArrow || input === 'k') { setTargetCursor((prev) => Math.max(0, prev - 1)); return; }
      if (key.downArrow || input === 'j') { setTargetCursor((prev) => Math.min(targets.length - 1, prev + 1)); return; }
      if (key.return) {
        const target = targets[targetCursor].value;
        let appliedCount = 0;
        let currentApplied = [...applied];
        for (const si of selectableIndices) {
          const item = actionItems[si];
          const existing = findAppliedItem(currentApplied, item.type, item.text);
          if (existing?.status === 'dismissed') continue;
          if (existing?.status === 'applied') continue;
          const result = appendToClaudeMd(target, item.type, item.text);
          if (result.success) {
            currentApplied = currentApplied.filter((a) => !(a.type === item.type && a.text === item.text));
            currentApplied.push({ type: item.type, text: item.text, status: 'applied', date: new Date().toISOString().split('T')[0] });
            appliedCount++;
          }
        }
        if (appliedCount > 0) {
          try { saveAppliedItems(currentApplied); setApplied(currentApplied); } catch { /* ignore */ }
          setStatusMsg(`✓ ${appliedCount}개 항목 일괄 적용됨`);
        } else {
          setStatusMsg('적용할 항목이 없습니다');
        }
        setApplyMode('none');
        return;
      }
      return;
    }

    // 이력 관리 모드
    if (applyMode === 'history') {
      if (key.escape || input === 'q') { setApplyMode('none'); return; }
      if (key.upArrow || input === 'k') { setHistoryCursor((prev) => Math.max(0, prev - 1)); return; }
      if (key.downArrow || input === 'j') { setHistoryCursor((prev) => Math.min(results.length - 1, prev + 1)); return; }
      if (input === 'x') {
        const updated = results.filter((_, i) => i !== historyCursor);
        try {
          saveCompoundResults(updated);
          setResults(updated);
          setHistoryCursor((prev) => Math.min(prev, Math.max(0, updated.length - 1)));
          setCursor(0);
          setStatusMsg('🗑 이력 삭제됨');
        } catch { /* ignore */ }
        if (updated.length === 0) setApplyMode('none');
        return;
      }
      return;
    }

    // 일반 모드
    if (input === 'c' && onRunCompound && !isRunning) onRunCompound(period);
    if (input === 'p' && !isRunning) {
      setPeriod((prev) => PERIOD_ORDER[(PERIOD_ORDER.indexOf(prev) + 1) % PERIOD_ORDER.length]);
    }
    if (input === 'r') { setResults(loadCompoundResults()); setApplied(loadAppliedItems()); }
    if ((key.upArrow || input === 'k') && selectableIndices.length > 0) {
      setCursor((prev) => Math.max(0, prev - 1));
    }
    if ((key.downArrow || input === 'j') && selectableIndices.length > 0) {
      setCursor((prev) => Math.min(selectableIndices.length - 1, prev + 1));
    }
    if (input === 'a' && selectableIndices.length > 0) { setApplyMode('selectTarget'); setTargetCursor(0); return; }
    if (input === 'd' && selectableIndices.length > 0) {
      const idx = selectableIndices[cursor];
      if (idx !== undefined) markItem(actionItems[idx], 'dismissed', applied, setApplied);
    }
    if (input === 'x' && results.length > 0) { setApplyMode('history'); setHistoryCursor(0); }
    if (input === 'u' && selectableIndices.length > 0) {
      const idx = selectableIndices[cursor];
      if (idx !== undefined) {
        const item = actionItems[idx];
        const updated = applied.filter((a) => !(a.type === item.type && a.text === item.text));
        try { saveAppliedItems(updated); setApplied(updated); } catch { /* ignore */ }
      }
    }
  });

  // 커서 범위 보정
  const safeCursor = Math.min(cursor, Math.max(0, selectableIndices.length - 1));
  useEffect(() => {
    if (safeCursor !== cursor) setCursor(safeCursor);
  }, [safeCursor, cursor]);

  // 상태 메시지 자동 소멸
  useEffect(() => {
    if (!statusMsg) return;
    const t = setTimeout(() => setStatusMsg(''), 4000);
    return () => clearTimeout(t);
  }, [statusMsg]);

  return (
    <Box flexDirection="column" gap={1}>
      {/* 기간 선택 바 */}
      <Box>
        <Text bold>📅 분석 기간: </Text>
        {PERIOD_ORDER.map((p) => (
          <Box key={p} marginRight={1}>
            <Text color={p === period ? 'cyan' : 'gray'} bold={p === period} inverse={p === period}>
              {' '}{PERIOD_LABELS[p]}{' '}
            </Text>
          </Box>
        ))}
        <Text dimColor> [p] 변경</Text>
      </Box>

      <CompoundResultPanel
        latest={latest}
        results={filteredResults}
        allResults={results}
        actionItems={actionItems}
        insightItems={insightItems}
        applied={applied}
        safeCursor={safeCursor}
        selectableIndices={selectableIndices}
        applyMode={applyMode}
        targets={targets}
        targetCursor={targetCursor}
        historyCursor={historyCursor}
        isRunning={isRunning}
        statusMsg={statusMsg}
      />

      <Text dimColor>
        {applyMode === 'none'
          ? '[a] 일괄 적용  [d] 무시  [u] 되돌리기  [j/k] 이동  [x] 이력관리  [p] 기간  [c] 실행  [r] 새로고침'
          : ''}
      </Text>
    </Box>
  );
}

function markItem(
  item: ListItem,
  status: 'applied' | 'dismissed',
  applied: AppliedCompoundItem[],
  setApplied: React.Dispatch<React.SetStateAction<AppliedCompoundItem[]>>,
) {
  const updated = applied.filter((a) => !(a.type === item.type && a.text === item.text));
  updated.push({ type: item.type, text: item.text, status, date: new Date().toISOString().split('T')[0] });
  try { saveAppliedItems(updated); setApplied(updated); } catch { /* ignore */ }
}
