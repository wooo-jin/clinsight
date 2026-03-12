import React from 'react';
import { Box, Text } from 'ink';

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** 데이터 길이에 맞는 날짜 라벨 동적 생성 */
function generateDayLabels(length: number): string[] {
  return Array.from({ length }, (_, i) => {
    const daysAgo = length - 1 - i;
    if (daysAgo === 0) return '오늘';
    if (daysAgo === 1) return '어제';
    return `${daysAgo}일전`;
  });
}

interface SparkLineProps {
  data: number[];
  color?: string;
  /** 값에 붙일 접미사 (예: '$', '/100') */
  suffix?: string;
  /** 값 포맷 함수 */
  formatValue?: (v: number) => string;
  /** 커스텀 라벨 배열 */
  labels?: string[];
}

export function SparkLine({
  data,
  color = 'cyan',
  suffix = '',
  formatValue,
  labels,
}: SparkLineProps) {
  if (data.length === 0) return <Text dimColor>데이터 없음</Text>;

  let max = data[0];
  let min = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i] > max) max = data[i];
    if (data[i] < min) min = data[i];
  }
  const range = max - min || 1;

  const fmt = formatValue ?? ((v: number) =>
    v >= 1000 ? `${(v / 1000).toFixed(1)}K` :
    v % 1 !== 0 ? v.toFixed(1) : String(v)
  );

  return (
    <Box flexDirection="column">
      {/* 바 차트 행 */}
      <Box>
        {data.map((v, i) => {
          const idx = Math.round(((v - min) / range) * (BLOCKS.length - 1));
          return (
            <Box key={i} width={10} justifyContent="center">
              <Text color={color}>{BLOCKS[idx]}</Text>
            </Box>
          );
        })}
      </Box>
      {/* 값 행 */}
      <Box>
        {data.map((v, i) => (
          <Box key={i} width={10} justifyContent="center">
            <Text dimColor>{fmt(v)}{suffix}</Text>
          </Box>
        ))}
      </Box>
      {/* 날짜 라벨 행 */}
      <Box>
        {(labels ?? generateDayLabels(data.length)).map((label, i) => (
          <Box key={i} width={10} justifyContent="center">
            <Text dimColor>{label}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
