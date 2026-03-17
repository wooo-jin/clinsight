import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Panel } from '../../../shared/ui/index.js';
import { pathBasename } from '../../../shared/lib/format.js';
import { ARCHIVE_DIR, type ArchivedSession } from '../lib/archive-writer.js';

/** 아카이브 디렉토리에서 세션 목록 로드 */
function loadArchiveSessions(): { date: string; sessions: ArchivedSession[] }[] {
  if (!existsSync(ARCHIVE_DIR)) return [];

  const dateDirs = readdirSync(ARCHIVE_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort((a, b) => b.localeCompare(a));

  const result: { date: string; sessions: ArchivedSession[] }[] = [];

  for (const dateDir of dateDirs.slice(0, 14)) {
    const dirPath = join(ARCHIVE_DIR, dateDir);
    const files = readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    const sessions: ArchivedSession[] = [];

    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(dirPath, file), 'utf-8')) as ArchivedSession;
        sessions.push(data);
      } catch { continue; }
    }

    sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    if (sessions.length > 0) {
      result.push({ date: dateDir, sessions });
    }
  }

  return result;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

/** XML/HTML 태그, 제어 문자, 연속 공백을 정리하여 표시용 텍스트로 변환 */
function sanitizeSummary(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')        // XML/HTML 태그 제거
    .replace(/\n/g, ' ')            // 개행 → 공백
    .replace(/\s{2,}/g, ' ')        // 연속 공백 정리
    .trim();
}

// App 오버헤드: 헤더(1)+margin(1)+탭바(1)+margin(1)+footer margin(1)+footer(1)=6
// ArchiveTab 목록 오버헤드: 저장위치(1)+Panel상하(2)+제목(1)+날짜(~2)+푸터힌트(1)=7
const ARCHIVE_OVERHEAD = 7; // 저장위치(1)+Panel상하(2)+제목(1)+날짜(~2)+푸터(1)
const MIN_pageSize = 3;

export function ArchiveTab({ maxHeight = 20 }: { maxHeight?: number }) {
  // maxHeight에서 오버헤드를 빼고, 각 항목은 2줄(본문+요약)+날짜 헤더 고려
  const pageSize = Math.max(MIN_pageSize, Math.floor((maxHeight - ARCHIVE_OVERHEAD) / 3));
  const [data, setData] = useState(() => loadArchiveSessions());
  const [sessionCursor, setSessionCursor] = useState(0);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [detailMsgPage, setDetailMsgPage] = useState(0);

  const allSessions = useMemo(() => {
    const flat: { date: string; session: ArchivedSession }[] = [];
    for (const group of data) {
      for (const session of group.sessions) {
        flat.push({ date: group.date, session });
      }
    }
    return flat;
  }, [data]);

  const totalCount = allSessions.length;
  const safeCursor = Math.min(sessionCursor, Math.max(0, totalCount - 1));
  const selected = allSessions[safeCursor];

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.floor(safeCursor / pageSize);
  const pageStart = currentPage * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, totalCount);

  useInput((input, key) => {
    if (viewMode === 'detail') {
      if (key.escape || input === 'q') {
        setViewMode('list');
        setDetailMsgPage(0);
        return;
      }
      if (key.leftArrow || input === 'h' || input === 'k') {
        setDetailMsgPage((p) => Math.max(0, p - 1));
      }
      if (key.rightArrow || input === 'l' || input === 'j') {
        if (selected) {
          const mp = Math.max(0, Math.ceil(selected.session.messages.length / 8) - 1);
          setDetailMsgPage((p) => Math.min(mp, p + 1));
        }
      }
      return;
    }

    if (key.upArrow || input === 'k') {
      setSessionCursor((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === 'j') {
      setSessionCursor((prev) => Math.min(totalCount - 1, prev + 1));
    }
    if (key.return && selected) {
      setViewMode('detail');
      setDetailMsgPage(0);
    }
    if (input === 'r') {
      setData(loadArchiveSessions());
      setSessionCursor(0);
    }
  });

  if (totalCount === 0) {
    return (
      <Panel title="📂 세션 아카이브">
        <Text color="yellow" bold>📁 {ARCHIVE_DIR.replace(homedir(), '~')}/</Text>
        <Text dimColor>아직 기록된 세션이 없습니다.</Text>
      </Panel>
    );
  }

  // 상세 뷰
  if (viewMode === 'detail' && selected) {
    const s = selected.session;
    const perPage = 8;
    const msgStart = detailMsgPage * perPage;
    const msgEnd = Math.min(msgStart + perPage, s.messages.length);
    const msgPages = Math.max(1, Math.ceil(s.messages.length / perPage));

    return (
      <Box flexDirection="column">
        <Panel title={`📂 ${selected.date} ${formatTime(s.startedAt)} — ${truncate(s.project, 40)}`}>
          <Text>{s.status === 'completed' ? '✓' : '⏳'} {s.durationMinutes}분 | {s.messages.length}msg | ${s.stats.estimatedCostUsd.toFixed(2)}</Text>
          {s.summary && <Text dimColor wrap="truncate">요약: {sanitizeSummary(s.summary)}</Text>}
        </Panel>
        <Panel title={`💬 ${msgStart + 1}-${msgEnd}/${s.messages.length} (p.${detailMsgPage + 1}/${msgPages})`}>
          {s.messages.slice(msgStart, msgEnd).map((msg, i) => (
            <Text key={i} wrap="truncate">
              {msg.role === 'user' ? '👤' : '🤖'} {truncate(sanitizeSummary(msg.content), 90)}
            </Text>
          ))}
        </Panel>
        <Text dimColor>[j/k h/l] 페이지  [Esc/q] 목록</Text>
      </Box>
    );
  }

  // 목록 뷰 — 줄 수를 확정적으로 제어
  const pageItems = allSessions.slice(pageStart, pageEnd);

  // 날짜별 그룹핑 + 텍스트 라인 빌드
  const lines: string[] = [];
  const selLines: boolean[] = [];
  let lastDate = '';
  for (let i = 0; i < pageItems.length; i++) {
    const { date, session: s } = pageItems[i];
    const globalIdx = pageStart + i;
    if (date !== lastDate) {
      lines.push(`── ${date} ──`);
      selLines.push(false);
      lastDate = date;
    }
    const isSel = globalIdx === safeCursor;
    const icon = s.status === 'completed' ? '✓' : '⏳';
    const projectName = pathBasename(s.project);
    const rawSummary = s.summary
      ?? (s.messages.find((m) => m.role === 'user')?.content ?? '');
    const summaryText = sanitizeSummary(rawSummary);
    const line = `${isSel ? '▸' : ' '} ${icon} ${formatTime(s.startedAt)} | ${s.durationMinutes}분 | $${s.stats.estimatedCostUsd.toFixed(2)} | ${projectName}`;
    lines.push(line);
    selLines.push(isSel);
    // 요약을 두 번째 줄로 표시
    lines.push(`    ${truncate(summaryText, 70)}`);
    selLines.push(isSel);
  }

  return (
    <Box flexDirection="column">
      <Text color="yellow" bold>📁 {ARCHIVE_DIR.replace(homedir(), '~')}/ <Text dimColor>({totalCount}개{totalPages > 1 ? `, p.${currentPage + 1}/${totalPages}` : ''})</Text></Text>
      <Panel title="📂 세션 아카이브">
        {lines.map((line, i) => (
          <Text
            key={i}
            wrap="truncate"
            color={selLines[i] ? 'cyan' : undefined}
            bold={selLines[i]}
            inverse={selLines[i]}
          >
            {line}
          </Text>
        ))}
      </Panel>
      <Text dimColor>[j/k] 이동  [Enter] 상세  [r] 새로고침</Text>
    </Box>
  );
}
