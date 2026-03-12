#!/usr/bin/env node
/**
 * Clinsight 설정 스크립트
 * 사용법:
 *   clinsight-setup             → hooks 설치 + 상태 확인
 *   clinsight-setup --uninstall → hooks 제거
 *   clinsight-setup --status    → 설치 상태 확인
 */
import { installHooks, uninstallHooks, checkHooksStatus } from './features/archive/lib/hooks-installer.js';
import { ARCHIVE_DIR } from './features/archive/lib/archive-writer.js';
import { mkdirSync } from 'fs';

function main() {
  const action = process.argv[2] ?? '';

  if (action === '--uninstall') {
    const removed = uninstallHooks();
    if (removed.length > 0) {
      console.log('✓ Clinsight hooks 제거 완료');
      console.log(`  제거된 이벤트: ${removed.join(', ')}`);
    } else {
      console.log('설치된 Clinsight hooks가 없습니다.');
    }
    return;
  }

  if (action === '--status') {
    printStatus();
    return;
  }

  // 기본: 설치
  console.log('=== Clinsight 설정 ===\n');

  // 아카이브 디렉토리 생성
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  console.log(`📁 아카이브 경로: ${ARCHIVE_DIR}`);

  // hooks 설치
  const { installed, skipped, error } = installHooks();
  console.log('');
  if (error) {
    console.error(`✗ ${error}`);
    console.error('  ~/.claude/settings.json을 확인하세요.');
    process.exit(1);
  }
  if (installed.length > 0) {
    console.log(`✓ Hooks 등록 완료: ${installed.join(', ')}`);
  }
  if (skipped.length > 0) {
    console.log(`  기존 유지: ${skipped.join(', ')}`);
  }

  console.log('');
  printStatus();

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  📌 Clinsight 설정 완료                          ║');
  console.log('║                                                  ║');
  console.log('║  ✅ Claude Code 세션이 자동으로 기록됩니다       ║');
  console.log(`║  📁 저장 위치: ${ARCHIVE_DIR}/`);
  console.log('║                                                  ║');
  console.log('║  사용법:                                         ║');
  console.log('║    clinsight        → 대시보드 실행              ║');
  console.log('║    clinsight-setup --status  → 상태 확인         ║');
  console.log('║    clinsight-setup --uninstall → 제거            ║');
  console.log('╚══════════════════════════════════════════════════╝');
}

function printStatus(): void {
  console.log('📋 Hook 상태:');
  const status = checkHooksStatus();
  for (const s of status) {
    const icon = s.installed ? '✓' : '✗';
    const color = s.installed ? '' : ' (미설치)';
    console.log(`  ${icon} ${s.event}${color}`);
  }
}

main();
