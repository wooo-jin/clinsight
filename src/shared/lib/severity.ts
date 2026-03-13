import type { Suggestion } from '../types/session.js';

/** severity 우선순위 (정렬용) */
export function severityRank(s: Suggestion['severity']): number {
  return s === 'critical' ? 3 : s === 'warning' ? 2 : 1;
}

/** severity별 터미널 색상 */
export function severityColor(s: Suggestion['severity']): string {
  return s === 'critical' ? 'red' : s === 'warning' ? 'yellow' : 'blue';
}

/** severity별 아이콘 */
export function severityIcon(s: Suggestion['severity']): string {
  return s === 'critical' ? '🔴' : s === 'warning' ? '🟡' : '🔵';
}
