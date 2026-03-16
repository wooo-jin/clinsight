import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPeriodRange, PERIOD_ORDER, PERIOD_LABELS } from '../period.js';

describe('period', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('PERIOD_ORDER', () => {
    it('6개 기간을 포함한다', () => {
      expect(PERIOD_ORDER).toHaveLength(6);
      expect(PERIOD_ORDER).toEqual([
        'today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'all',
      ]);
    });

    it('모든 기간에 라벨이 있다', () => {
      for (const p of PERIOD_ORDER) {
        expect(PERIOD_LABELS[p]).toBeTruthy();
      }
    });
  });

  describe('getPeriodRange', () => {
    it('all은 null을 반환한다', () => {
      expect(getPeriodRange('all')).toBeNull();
    });

    it('today는 오늘 00:00부터 시작하고 end가 없다', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-16T14:30:00'));

      const range = getPeriodRange('today')!;
      expect(range.start).toEqual(new Date('2026-03-16T00:00:00'));
      expect(range.end).toBeUndefined();
    });

    it('yesterday는 어제 00:00 ~ 오늘 00:00', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-16T14:30:00'));

      const range = getPeriodRange('yesterday')!;
      expect(range.start).toEqual(new Date('2026-03-15T00:00:00'));
      expect(range.end).toEqual(new Date('2026-03-16T00:00:00'));
    });

    // 2026-03-16은 월요일
    it('thisWeek는 이번 주 월요일 00:00부터 시작한다 (월요일 기준)', () => {
      vi.useFakeTimers();
      // 2026-03-18 수요일
      vi.setSystemTime(new Date('2026-03-18T10:00:00'));

      const range = getPeriodRange('thisWeek')!;
      expect(range.start).toEqual(new Date('2026-03-16T00:00:00')); // 월요일
      expect(range.end).toBeUndefined();
    });

    it('thisWeek - 일요일에도 해당 주 월요일을 반환한다', () => {
      vi.useFakeTimers();
      // 2026-03-22 일요일
      vi.setSystemTime(new Date('2026-03-22T10:00:00'));

      const range = getPeriodRange('thisWeek')!;
      expect(range.start).toEqual(new Date('2026-03-16T00:00:00')); // 월요일
    });

    it('lastWeek는 지난주 월요일 ~ 이번주 월요일', () => {
      vi.useFakeTimers();
      // 2026-03-18 수요일
      vi.setSystemTime(new Date('2026-03-18T10:00:00'));

      const range = getPeriodRange('lastWeek')!;
      expect(range.start).toEqual(new Date('2026-03-09T00:00:00')); // 지난주 월요일
      expect(range.end).toEqual(new Date('2026-03-16T00:00:00'));   // 이번주 월요일
    });

    it('thisMonth는 이번 달 1일부터 시작한다', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-18T10:00:00'));

      const range = getPeriodRange('thisMonth')!;
      expect(range.start).toEqual(new Date('2026-03-01T00:00:00'));
      expect(range.end).toBeUndefined();
    });

    it('월초(1일)에도 thisMonth가 정상 동작한다', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-01T00:00:00'));

      const range = getPeriodRange('thisMonth')!;
      expect(range.start).toEqual(new Date('2026-04-01T00:00:00'));
    });
  });

  describe('기간 경계 케이스', () => {
    it('자정(00:00)에 today와 yesterday가 정확히 구분된다', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-16T00:00:00'));

      const today = getPeriodRange('today')!;
      const yesterday = getPeriodRange('yesterday')!;

      // 자정 시점은 today에 포함
      expect(new Date('2026-03-16T00:00:00') >= today.start).toBe(true);
      // yesterday의 end는 오늘 00:00 (exclusive)
      expect(yesterday.end).toEqual(new Date('2026-03-16T00:00:00'));
    });

    it('월요일에 thisWeek.start와 lastWeek.end가 같다', () => {
      vi.useFakeTimers();
      // 2026-03-16 월요일
      vi.setSystemTime(new Date('2026-03-16T10:00:00'));

      const thisWeek = getPeriodRange('thisWeek')!;
      const lastWeek = getPeriodRange('lastWeek')!;

      expect(thisWeek.start).toEqual(lastWeek.end);
    });
  });
});
