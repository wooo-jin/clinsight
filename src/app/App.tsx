import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadRecentSessions } from '../entities/session/index.js';
import { analyzeSession } from '../entities/session/index.js';
import { runCompoundAsync } from '../entities/session/lib/compound.js';
import { atomicWriteSync } from '../shared/lib/fs-utils.js';
import type { CompoundPeriod } from '../shared/lib/period.js';
import { getPeriodRange } from '../shared/lib/period.js';
import type { ParsedSession } from '../shared/types/session.js';
import { DashboardTab } from '../features/dashboard/ui/DashboardTab.js';
import { InsightsTab } from '../features/insights/ui/InsightsTab.js';
import { SessionsTab } from '../features/sessions/ui/SessionsTab.js';
import { CostTab } from '../features/cost/ui/CostTab.js';
import { CompoundTab } from '../features/compound/ui/CompoundTab.js';
import { ArchiveTab } from '../features/archive/ui/ArchiveTab.js';
import { SettingsTab } from '../features/settings/ui/SettingsTab.js';
import { DEFAULT_SESSION_COUNT } from '../shared/lib/constants.js';

const TABS = [
  { key: '1', label: 'Dashboard', icon: '📊' },
  { key: '2', label: 'Insights', icon: '💡' },
  { key: '3', label: 'Sessions', icon: '📋' },
  { key: '4', label: 'Cost', icon: '💰' },
  { key: '5', label: 'Compound', icon: '📦' },
  { key: '6', label: 'Archive', icon: '📂' },
  { key: '7', label: 'Settings', icon: '⚙️' },
] as const;

const REFRESH_INTERVAL_MS = 60_000; // 1분마다 갱신

function filterSessionsByPeriod(sessions: ParsedSession[], period: CompoundPeriod): ParsedSession[] {
  const range = getPeriodRange(period);
  if (!range) return sessions; // 'all'

  return sessions.filter((s) => {
    if (range.end) return s.startTime >= range.start && s.startTime < range.end;
    return s.startTime >= range.start;
  });
}

/** 동기적으로 데이터 로드 */
function loadData() {
  const sessions = loadRecentSessions(DEFAULT_SESSION_COUNT);
  const analyses = sessions.map((s) => analyzeSession(s));
  return { sessions, analyses };
}

export function App() {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState(0);

  // lazy initializer: 첫 렌더에서만 1회 실행 (매 렌더 I/O 방지)
  const [data, setData] = useState(() => loadData());
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const { sessions, analyses } = data;

  const [compoundRunning, setCompoundRunning] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  const refreshData = useCallback(() => {
    setData(loadData());
    setLastRefresh(new Date());
  }, []);

  const handleRunCompound = useCallback((period: CompoundPeriod = 'today') => {
    if (compoundRunning) return;
    setCompoundRunning(true);
    const filtered = filterSessionsByPeriod(sessions, period);
    runCompoundAsync(filtered)
      .finally(() => setCompoundRunning(false));
  }, [sessions, compoundRunning]);

  // 주기적 자동 갱신
  useEffect(() => {
    const timer = setInterval(refreshData, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshData]);

  useInput((input: string, key: { tab?: boolean }) => {
    // s: 세션 데이터 파일로 내보내기
    if (input === 's') {
      const dir = join(homedir(), '.claude', 'clinsight', 'sessions');
      mkdirSync(dir, { recursive: true });
      const dateStr = new Date().toISOString().split('T')[0];
      const timeStr = new Date().toISOString().split('T')[1].slice(0, 5).replace(':', '');
      const filePath = join(dir, `${dateStr}_${timeStr}.json`);
      const exportData = sessions.map((s, i) => ({
        ...s,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        analysis: analyses[i],
      }));
      atomicWriteSync(filePath, JSON.stringify(exportData, null, 2));
      setExportMsg(`저장됨: ${filePath}`);
      setTimeout(() => setExportMsg(''), 3000);
      return;
    }

    // 수동 갱신 (CompoundTab이 아닌 경우만 — CompoundTab은 자체 r 핸들러 사용)
    if (input === 'r' && activeTab !== 4) {
      refreshData();
      return;
    }

    // 탭 전환: 숫자키
    const tabIndex = parseInt(input) - 1;
    if (tabIndex >= 0 && tabIndex < TABS.length) {
      setActiveTab(tabIndex);
      return;
    }

    if (key.tab) {
      setActiveTab((prev: number) => (prev + 1) % TABS.length);
      return;
    }

    if (input === 'q') {
      exit();
    }
  });

  const refreshTime = `${lastRefresh.getHours().toString().padStart(2, '0')}:${lastRefresh.getMinutes().toString().padStart(2, '0')}`;

  const termHeight = process.stdout.rows ?? 40;

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* 헤더 */}
      <Box marginBottom={1}>
        <Text bold color="cyan"> Clinsight </Text>
        <Text dimColor> | {sessions.length} sessions | updated {refreshTime}</Text>
      </Box>

      {/* 탭 바 */}
      <Box marginBottom={1}>
        {TABS.map((tab, i) => (
          <Box key={tab.key} marginRight={1}>
            <Text
              bold={i === activeTab}
              color={i === activeTab ? 'cyan' : 'gray'}
              inverse={i === activeTab}
            >
              {' '}{tab.icon} {tab.label}{' '}
            </Text>
          </Box>
        ))}
      </Box>

      {/* 탭 콘텐츠 */}
      <Box flexDirection="column" flexGrow={1}>
        {activeTab === 0 && <DashboardTab sessions={sessions} analyses={analyses} />}
        {activeTab === 1 && <InsightsTab sessions={sessions} analyses={analyses} />}
        {activeTab === 2 && <SessionsTab sessions={sessions} analyses={analyses} />}
        {activeTab === 3 && <CostTab sessions={sessions} analyses={analyses} />}
        {activeTab === 4 && (
          <CompoundTab
            onRunCompound={handleRunCompound}
            isRunning={compoundRunning}
            projects={sessions.map((s) => s.project)}
          />
        )}
        {activeTab === 5 && <ArchiveTab maxHeight={termHeight - 7} />}
        {activeTab === 6 && <SettingsTab />}
      </Box>

      {/* 푸터 */}
      <Box marginTop={1}>
        <Text dimColor>
          [1-7] 탭 전환  [Tab] 이동  [r] 새로고침  [s] 내보내기  [q] 종료
        </Text>
      </Box>
      {exportMsg && (
        <Text color="green" bold>{exportMsg}</Text>
      )}
    </Box>
  );
}
