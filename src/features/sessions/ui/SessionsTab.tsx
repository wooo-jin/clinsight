import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { Panel } from '../../../shared/ui/index.js';
import { padEnd, pathBasename, pathTail } from '../../../shared/lib/format.js';
import type { ParsedSession, SessionAnalysis } from '../../../shared/types/session.js';
import { format } from 'date-fns';
import { scanZombies, cleanAllZombies } from '../lib/zombie.js';
import type { ZombieInfo } from '../lib/zombie.js';
import { isSessionActive, efficiencyLabel, SESSION_LIST_LIMIT } from '../lib/session-helpers.js';
import { ZombiePanel } from './ZombiePanel.js';

type ViewMode = 'list' | 'zombie';

interface SessionsTabProps {
  sessions: ParsedSession[];
  analyses: SessionAnalysis[];
}

export function SessionsTab({ sessions, analyses }: SessionsTabProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [zombieInfo, setZombieInfo] = useState<ZombieInfo | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(sessions.length / SESSION_LIST_LIMIT);

  // sessions prop 변경 시 선택 인덱스 리셋
  useEffect(() => {
    setSelectedIdx(0);
    setPage(0);
  }, [sessions]);

  const activeSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      if (isSessionActive(s)) set.add(s.sessionId);
    }
    return set;
  }, [sessions]);

  useInput((input, key) => {
    // 좀비 모드
    if (viewMode === 'zombie') {
      if (key.escape || input === 'q') {
        setViewMode('list');
        return;
      }
      // x: 좀비 일괄 정리
      if (input === 'x' && zombieInfo) {
        const total = zombieInfo.processes.length + zombieInfo.orphanDirs.length;
        if (total === 0) return;
        setStatusMsg('🔄 정리 중...');
        // 즉시 "정리 중" 표시 후 다음 틱에서 실행
        setTimeout(() => {
          const result = cleanAllZombies();
          setStatusMsg(`🧹 정리 완료: 프로세스 ${result.killedPids.length}개 종료, 디렉토리 ${result.cleanedDirs.length}개 삭제`);
          setZombieInfo(scanZombies());
          setTimeout(() => setStatusMsg(''), 6000);
        }, 50);
      }
      return;
    }

    // 일반 목록 모드
    const pageStart = page * SESSION_LIST_LIMIT;
    const pageEnd = Math.min(pageStart + SESSION_LIST_LIMIT, sessions.length);
    const pageSize = pageEnd - pageStart;

    if (key.upArrow || input === 'k') {
      if (selectedIdx <= 0 && page > 0) {
        setPage((p) => p - 1);
        setSelectedIdx(SESSION_LIST_LIMIT - 1);
      } else {
        setSelectedIdx((prev) => Math.max(0, prev - 1));
      }
      setExpanded(false);
    }
    if (key.downArrow || input === 'j') {
      if (selectedIdx >= pageSize - 1 && page < totalPages - 1) {
        setPage((p) => p + 1);
        setSelectedIdx(0);
      } else {
        setSelectedIdx((prev) => Math.min(pageSize - 1, prev + 1));
      }
      setExpanded(false);
    }
    if (key.return) {
      setExpanded((prev) => !prev);
    }
    // z: 좀비 스캔 모드 진입
    if (input === 'z') {
      setStatusMsg('🔍 좀비 스캔 중...');
      setViewMode('zombie');
      setTimeout(() => {
        const info = scanZombies();
        setZombieInfo(info);
        const total = info.processes.length + info.orphanDirs.length;
        setStatusMsg(total > 0
          ? `👻 좀비 ${total}개 발견`
          : '✓ 좀비 없음');
        setTimeout(() => setStatusMsg(''), 6000);
      }, 50);
    }
    // o: 새 터미널에서 세션 열기 (일반 목록 모드에서만)
    const currentSessions = sessions.slice(pageStart, pageEnd);
    if (viewMode === 'list' && input === 'o' && currentSessions[selectedIdx]) {
      const session = currentSessions[selectedIdx];
      const sid = session.sessionId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(sid)) return;
      // AppleScript: 백슬래시를 먼저 이스케이프, 그 다음 쌍따옴표 이스케이프
      const appleEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      // Shell: 작은따옴표 이스케이프
      const shellEscape = (s: string) => s.replace(/'/g, "'\\''");
      if (process.platform === 'darwin') {
        const script = `cd '${shellEscape(session.project)}' && claude --resume ${sid}`;
        spawn('osascript', [
          '-e', `tell application "Terminal" to do script "${appleEscape(script)}"`,
          '-e', 'tell application "Terminal" to activate',
        ], { detached: true, stdio: 'ignore' }).unref();
      } else {
        const script = `cd '${shellEscape(session.project)}' && claude --resume ${sid}`;
        spawn('sh', ['-c', `x-terminal-emulator -e "sh -c '${script}'" 2>/dev/null || gnome-terminal -- sh -c '${script}' 2>/dev/null`],
          { detached: true, stdio: 'ignore' }).unref();
      }
    }
  });

  if (sessions.length === 0) {
    return (
      <Panel title="📋 세션 목록">
        <Text dimColor>세션 데이터가 없습니다.</Text>
      </Panel>
    );
  }

  const currentPageStart = page * SESSION_LIST_LIMIT;
  const pageSessions = sessions.slice(currentPageStart, currentPageStart + SESSION_LIST_LIMIT);
  const selected = pageSessions[selectedIdx] ?? sessions[0];
  const selectedAnalysis = analyses.find((a) => a.sessionId === selected?.sessionId);
  const activeCount = activeSet.size;

  return (
    <Box flexDirection="column" gap={1}>
      {/* 좀비 모드 */}
      {viewMode === 'zombie' && (
        <ZombiePanel zombieInfo={zombieInfo} statusMsg={statusMsg} />
      )}

      {/* 일반 목록 모드 */}
      {viewMode === 'list' && (
        <>
          <Panel title="📋 세션 목록">
            {/* 상태 요약 */}
            <Box marginBottom={1}>
              <Text>
                전체 <Text bold>{sessions.length}</Text>개
                {' | '}
                <Text color="green" bold>{activeCount}</Text> 활성
                {' | '}
                <Text dimColor>{sessions.length - activeCount} 종료</Text>
                {totalPages > 1 && (
                  <Text dimColor> | 페이지 {page + 1}/{totalPages}</Text>
                )}
              </Text>
            </Box>

            {/* 헤더 */}
            <Box>
              <Text bold wrap="truncate">{padEnd('', 3)}</Text>
              <Text bold wrap="truncate">{padEnd('#', 4)}</Text>
              <Text bold wrap="truncate">{padEnd('시각', 8)}</Text>
              <Text bold wrap="truncate">{padEnd('프로젝트', 24)}</Text>
              <Text bold wrap="truncate">{padEnd('시간', 6)}</Text>
              <Text bold wrap="truncate">{padEnd('도구', 6)}</Text>
              <Text bold wrap="truncate">{padEnd('효율', 6)}</Text>
            </Box>

            {/* 세션 목록 */}
            {pageSessions.map((session, i) => {
              const analysis = analyses.find((a) => a.sessionId === session.sessionId);
              const isSelected = i === selectedIdx;
              const projectShort = pathBasename(session.project);
              const active = activeSet.has(session.sessionId);
              const statusIcon = active ? '●' : '○';
              const statusColor = active ? 'green' : 'gray';

              return (
                <Box key={session.sessionId}>
                  <Text color={statusColor}>{statusIcon} </Text>
                  <Text
                    color={isSelected ? 'cyan' : undefined}
                    bold={isSelected}
                    inverse={isSelected}
                    wrap="truncate"
                  >
                    {padEnd(isSelected ? '▸' + String(i + 1) : ' ' + String(i + 1), 4)}
                    {padEnd(format(session.startTime, 'HH:mm'), 8)}
                    {padEnd(projectShort, 24)}
                    {padEnd(session.durationMinutes + 'm', 6)}
                    {padEnd(String(session.toolUseCount), 6)}
                    {padEnd(
                      analysis ? efficiencyLabel(analysis.efficiencyScore) : '-',
                      6,
                    )}
                  </Text>
                </Box>
              );
            })}
          </Panel>

          {/* 선택된 세션 상세 */}
          {expanded && selectedAnalysis && (
            <Panel title={`🔍 세션 #${selectedIdx + 1} 상세`}>
              <Box>
                <Text>세션 ID: <Text color="cyan">{selected.sessionId.slice(0, 8)}</Text></Text>
                <Text> </Text>
                {activeSet.has(selected.sessionId)
                  ? <Text color="green" bold>● 활성</Text>
                  : <Text dimColor>○ 종료</Text>
                }
              </Box>
              <Text wrap="truncate">프로젝트: {selected.project}</Text>
              <Text>
                시간: {format(selected.startTime, 'HH:mm')} ~{' '}
                {format(selected.endTime, 'HH:mm')} ({selected.durationMinutes}분)
              </Text>
              <Text>사용자 메시지: {selected.userMessageCount}개</Text>
              <Text>효율 점수: {selectedAnalysis.efficiencyScore}/100</Text>
              <Text>1회 해결률: {selectedAnalysis.firstTryRate}%</Text>
              <Text>삽질 지수: {selectedAnalysis.churnIndex}</Text>
              <Text>컨텍스트 포화도: ~{selectedAnalysis.contextSaturation}%</Text>

              {/* 도구 분포 */}
              <Text bold>도구 사용:</Text>
              {Object.entries(selected.toolBreakdown)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([name, count]) => (
                  <Text key={name}>  {name}: {count}</Text>
                ))}

              {/* 반복 편집 */}
              {Object.keys(selected.repeatedEdits).length > 0 && (
                <>
                  <Text bold color="yellow">반복 편집:</Text>
                  {Object.entries(selected.repeatedEdits).map(([file, count]) => (
                    <Text key={file} color="yellow">
                      {'  '}{pathTail(file, 2)}: {count}회
                    </Text>
                  ))}
                </>
              )}

              {/* 제안 */}
              {selectedAnalysis.suggestions.length > 0 && (
                <>
                  <Text bold>💡 제안:</Text>
                  {selectedAnalysis.suggestions.map((s, i) => (
                    <Text key={i} color={s.severity === 'critical' ? 'red' : 'yellow'}>
                      {'  '}{s.message}
                    </Text>
                  ))}
                </>
              )}
            </Panel>
          )}
        </>
      )}

      {statusMsg && (
        <Text color={statusMsg.includes('발견') ? 'yellow' : 'green'} bold>
          {statusMsg}
        </Text>
      )}

      <Text dimColor>
        {viewMode === 'list'
          ? '[j/k] 이동  [Enter] 상세  [o] 세션 열기  [z] 좀비 스캔'
          : '[x] 좀비 정리  [q/Esc] 돌아가기'}
      </Text>
    </Box>
  );
}