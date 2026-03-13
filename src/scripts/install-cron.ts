#!/usr/bin/env node
/**
 * 크론잡 설치/제거 스크립트
 * 사용법: pnpm cron:install        (설치)
 *         pnpm cron:install remove  (제거)
 *
 * macOS/Linux: crontab 사용
 * Windows: schtasks 사용
 */
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const IS_WINDOWS = process.platform === 'win32';
const CRON_MARKER = 'clinsight';
const TASK_NAME = 'ClinsightNightlyCompound';

/** dist/cron.js 경로 (npm global install에서도 동작) */
function getCronScriptPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const distDir = dirname(dirname(thisFile)); // dist/scripts/ → dist/
  // distDir이 이미 dist/ 폴더이므로 바로 cron.js를 붙임
  return join(distDir, 'cron.js');
}

// ── Unix (macOS/Linux) ──

const CRON_SCHEDULE = '0 23 * * *';

function getCronCommand(): string {
  const cronScript = getCronScriptPath();
  // 크론 환경은 최소 PATH만 사용하므로 node 절대 경로 필요 (nvm/fnm 등)
  const nodePath = process.execPath;
  return `${nodePath} "${cronScript}" >> ~/.claude/clinsight/cron.log 2>&1`;
}

function getCurrentCrontab(): string {
  try {
    return execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
  } catch {
    return '';
  }
}

/** 파일 기반으로 crontab 설정 (셸 인젝션 방지) */
function setCrontab(content: string): void {
  const tmpFile = join(tmpdir(), `crontab-${Date.now()}.tmp`);
  try {
    writeFileSync(tmpFile, content);
    execSync(`crontab "${tmpFile}"`, { encoding: 'utf-8' });
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function installUnix(): void {
  let current = getCurrentCrontab();

  // 기존 이름(claude-compound-hud) 크론 제거
  const OLD_MARKER = 'claude-compound-hud';
  if (current.includes(OLD_MARKER)) {
    current = current.split('\n').filter((line) => !line.includes(OLD_MARKER)).join('\n');
    console.log('✓ 기존 claude-compound-hud 크론잡 제거');
  }

  if (current.includes(CRON_MARKER)) {
    console.log('이미 크론잡이 등록되어 있습니다.');
    console.log('제거하려면: pnpm cron:install remove');
    return;
  }

  const cronLine = `${CRON_SCHEDULE} ${getCronCommand()} # ${CRON_MARKER}`;
  const newCrontab = current.trimEnd() + '\n' + cronLine + '\n';
  setCrontab(newCrontab);

  console.log('✓ 크론잡이 등록되었습니다.');
  console.log(`  스케줄: 매일 23:00`);
  console.log(`  로그: ~/.claude/clinsight/cron.log`);
  console.log(`  제거: pnpm cron:install remove`);
}

function removeUnix(): void {
  const current = getCurrentCrontab();
  const filtered = current
    .split('\n')
    .filter((line) => !line.includes(CRON_MARKER))
    .join('\n');

  setCrontab(filtered);
  console.log('✓ 크론잡이 제거되었습니다.');
}

// ── Windows ──

function installWindows(): void {
  const cronScript = getCronScriptPath();
  try {
    // 기존 태스크 확인
    try {
      execSync(`schtasks /Query /TN "${TASK_NAME}" 2>nul`, { encoding: 'utf-8' });
      console.log('이미 예약 작업이 등록되어 있습니다.');
      console.log(`제거하려면: pnpm cron:install remove`);
      return;
    } catch { /* 태스크 없음 — 계속 진행 */ }

    const nodePath = process.execPath;
    execSync(
      `schtasks /Create /TN "${TASK_NAME}" /TR "\\"${nodePath}\\" \\"${cronScript}\\"" /SC DAILY /ST 23:00 /F`,
      { encoding: 'utf-8' },
    );
    console.log('✓ 예약 작업이 등록되었습니다.');
    console.log(`  스케줄: 매일 23:00`);
    console.log(`  태스크 이름: ${TASK_NAME}`);
    console.log(`  제거: pnpm cron:install remove`);
  } catch (err) {
    console.error('✗ 예약 작업 등록 실패 (관리자 권한이 필요할 수 있습니다)');
    if (err instanceof Error) console.error(`  ${err.message}`);
  }
}

function removeWindows(): void {
  try {
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F 2>nul`, { encoding: 'utf-8' });
    console.log('✓ 예약 작업이 제거되었습니다.');
  } catch {
    console.log('등록된 예약 작업이 없습니다.');
  }
}

// ── Main ──

function main() {
  const action = process.argv[2] || 'install';

  if (action === 'remove') {
    IS_WINDOWS ? removeWindows() : removeUnix();
  } else {
    IS_WINDOWS ? installWindows() : installUnix();
  }
}

main();
