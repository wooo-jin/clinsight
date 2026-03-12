/** 고정 캘린더 기반 기간 정의 */

export type CompoundPeriod = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'all';

export const PERIOD_LABELS: Record<CompoundPeriod, string> = {
  today: '오늘',
  yesterday: '어제',
  thisWeek: '이번 주',
  lastWeek: '지난주',
  thisMonth: '이번 달',
  all: '전체',
};

export const PERIOD_ORDER: CompoundPeriod[] = [
  'today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'all',
];

export interface PeriodRange {
  start: Date;
  end?: Date; // undefined = now까지
}

/** 월요일 기준 주 시작일 계산 */
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  // 일요일(0) → 6일 전, 월요일(1) → 0일 전, ...
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

/** 기간에 해당하는 시작/종료 날짜 반환 */
export function getPeriodRange(period: CompoundPeriod): PeriodRange | null {
  if (period === 'all') return null;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      return { start: todayStart };

    case 'yesterday': {
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      return { start: yesterdayStart, end: todayStart };
    }

    case 'thisWeek': {
      const monday = getMondayOfWeek(todayStart);
      return { start: monday };
    }

    case 'lastWeek': {
      const thisMonday = getMondayOfWeek(todayStart);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(lastMonday.getDate() - 7);
      return { start: lastMonday, end: thisMonday };
    }

    case 'thisMonth': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: monthStart };
    }
  }
}
