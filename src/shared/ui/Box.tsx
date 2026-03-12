import React from 'react';
import { Box as InkBox, Text } from 'ink';
import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  children: ReactNode;
  width?: number | string;
}

export function Panel({ title, children, width }: PanelProps) {
  return (
    <InkBox
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      width={width as number | undefined}
    >
      <Text bold color="cyan">{title}</Text>
      {children}
    </InkBox>
  );
}
