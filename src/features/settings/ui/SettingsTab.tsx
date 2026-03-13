import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { homedir } from 'os';
import { Panel } from '../../../shared/ui/index.js';
import { loadConfig, saveConfig, CONFIG_PATH } from '../../../shared/lib/config.js';
import { getArchiveSize } from '../../archive/lib/archive-writer.js';
import type { ClinsightConfig } from '../../../shared/lib/config.js';

interface SettingItem {
  key: keyof ClinsightConfig;
  label: string;
  description: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  zeroLabel: string;
}

const SETTINGS: SettingItem[] = [
  {
    key: 'archiveRetentionDays',
    label: '아카이브 보관 기간',
    description: '세션 대화 기록 보관 일수',
    unit: '일',
    step: 7,
    min: 0,
    max: 365,
    zeroLabel: '무제한',
  },
  {
    key: 'compoundRetentionDays',
    label: '컴파운드 히스토리 보관',
    description: '복리화 분석 결과 보관 일수',
    unit: '일',
    step: 7,
    min: 0,
    max: 365,
    zeroLabel: '무제한',
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function SettingsTab() {
  const [config, setConfig] = useState<ClinsightConfig>(() => loadConfig());
  const [cursor, setCursor] = useState(0);
  const [saved, setSaved] = useState(false);
  const [archiveInfo, setArchiveInfo] = useState(() => getArchiveSize());

  useInput((input: string, key: { upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean }) => {
    if (key.upArrow) {
      setCursor((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((prev) => Math.min(SETTINGS.length - 1, prev + 1));
      return;
    }

    const setting = SETTINGS[cursor];
    if (!setting) return;

    if (key.rightArrow || input === '+') {
      setConfig((prev) => {
        const newVal = Math.min(setting.max, prev[setting.key] + setting.step);
        const updated = { ...prev, [setting.key]: newVal };
        saveConfig(updated);
        setSaved(true);
        setArchiveInfo(getArchiveSize());
        setTimeout(() => setSaved(false), 2000);
        return updated;
      });
      return;
    }

    if (key.leftArrow || input === '-') {
      setConfig((prev) => {
        const newVal = Math.max(setting.min, prev[setting.key] - setting.step);
        const updated = { ...prev, [setting.key]: newVal };
        saveConfig(updated);
        setSaved(true);
        setArchiveInfo(getArchiveSize());
        setTimeout(() => setSaved(false), 2000);
        return updated;
      });
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Panel title="⚙️ 설정">
        <Box flexDirection="column">
          {SETTINGS.map((setting, i) => {
            const value = config[setting.key];
            const display = value === 0 ? setting.zeroLabel : `${value}${setting.unit}`;
            const isActive = i === cursor;

            return (
              <Box key={setting.key} flexDirection="column" marginBottom={1}>
                <Box>
                  <Text color={isActive ? 'cyan' : undefined} dimColor={!isActive} bold={isActive}>
                    {isActive ? '>' : ' '} {setting.label}
                  </Text>
                </Box>
                <Box marginLeft={3}>
                  <Text dimColor>{setting.description}</Text>
                </Box>
                <Box marginLeft={3}>
                  <Text color={isActive ? 'yellow' : 'gray'}>{'◀ '}</Text>
                  <Text bold color={isActive ? 'green' : 'white'}>{` ${display} `}</Text>
                  <Text color={isActive ? 'yellow' : 'gray'}>{' ▶'}</Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Panel>

      <Panel title="📊 저장소 현황">
        <Text>아카이브: <Text bold>{archiveInfo.sessionCount}</Text>개 세션 / <Text bold>{archiveInfo.dayCount}</Text>일 / <Text bold>{formatBytes(archiveInfo.totalBytes)}</Text></Text>
        <Text dimColor wrap="truncate">경로: {CONFIG_PATH.replace(homedir(), '~')}</Text>
      </Panel>

      <Box marginTop={1}>
        <Text dimColor>[↑↓] 항목 선택  [←→] 값 변경  </Text>
        {saved && <Text color="green" bold> 저장됨! 다음 크론 실행 시 적용됩니다</Text>}
      </Box>
    </Box>
  );
}
