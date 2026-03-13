import React from 'react';
import { Text } from 'ink';

interface BarProps {
  value: number; // 0-100
  width?: number;
  colorThresholds?: { green: number; yellow: number };
}

export function Bar({
  value,
  width = 20,
  colorThresholds = { green: 50, yellow: 80 },
}: BarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  const color = clamped < colorThresholds.green
    ? 'green'
    : clamped < colorThresholds.yellow
      ? 'yellow'
      : 'red';

  return (
    <Text>
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text> {clamped}%</Text>
    </Text>
  );
}
