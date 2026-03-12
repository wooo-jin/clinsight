import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '../../../shared/ui/index.js';
import type { ZombieInfo } from '../lib/zombie.js';

interface ZombiePanelProps {
  zombieInfo: ZombieInfo | null;
  statusMsg: string;
}

export function ZombiePanel({ zombieInfo, statusMsg }: ZombiePanelProps) {
  if (!zombieInfo) {
    return (
      <Panel title="👻 좀비 Claude 스캔">
        <Text color="yellow">🔍 스캔 중...</Text>
      </Panel>
    );
  }

  const total = zombieInfo.processes.length + zombieInfo.orphanDirs.length;

  return (
    <Panel title="👻 좀비 Claude 스캔 결과">
      {total === 0 ? (
        <>
          <Text color="green" bold>좀비 프로세스 없음 ✓</Text>
          {statusMsg && <Text color="green" bold>{statusMsg}</Text>}
        </>
      ) : (
        <>
          {zombieInfo.processes.length > 0 && (
            <>
              <Text bold color="red">좀비 프로세스: {zombieInfo.processes.length}개</Text>
              {zombieInfo.processes.map((p) => (
                <Text key={p.pid} color="yellow">
                  {'  '}PID {p.pid} | {p.elapsed} | {p.command}
                </Text>
              ))}
            </>
          )}
          {zombieInfo.orphanDirs.length > 0 && (
            <>
              <Text bold color="red">고아 세션 디렉토리: {zombieInfo.orphanDirs.length}개</Text>
              {zombieInfo.orphanDirs.slice(0, 5).map((d) => (
                <Text key={d.fullPath} color="yellow">
                  {'  '}{d.sessionId.slice(0, 8)}... ({d.projectDir})
                </Text>
              ))}
            </>
          )}
        </>
      )}
      {statusMsg && total > 0 && (
        <Box marginTop={1}>
          <Text color="green" bold>{statusMsg}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {total > 0 ? '[x] 일괄 정리  [Esc] 돌아가기' : '[Esc] 돌아가기'}
        </Text>
      </Box>
    </Panel>
  );
}
