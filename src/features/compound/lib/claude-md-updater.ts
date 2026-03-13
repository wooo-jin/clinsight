import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { atomicWriteSync } from '../../../shared/lib/fs-utils.js';
import type { AppliedCompoundItem } from '../../../shared/types/session.js';

const GLOBAL_CLAUDE_MD = join(homedir(), '.claude', 'CLAUDE.md');
const COMPOUND_SECTION_HEADER = '## Compound Insights';

const SUBSECTION_HEADERS: Record<AppliedCompoundItem['type'], string> = {
  pattern: '### 패턴',
  solution: '### 솔루션',
  convention: '### 컨벤션',
  goldenPrompt: '### 골든 프롬프트',
  preventionRule: '### 예방 규칙',
};

/** 사용 가능한 프로젝트 CLAUDE.md 경로 목록 (세션에서 추출한 프로젝트 경로 기반) */
export function listProjectClaudeMdPaths(projects: string[]): { project: string; path: string; exists: boolean }[] {
  const seen = new Set<string>();
  const results: { project: string; path: string; exists: boolean }[] = [];

  for (const project of projects) {
    if (seen.has(project)) continue;
    seen.add(project);
    const mdPath = join(project, '.claude', 'CLAUDE.md');
    results.push({
      project,
      path: mdPath,
      exists: existsSync(mdPath),
    });
  }

  return results;
}

/** CLAUDE.md에 컴파운드 인사이트 항목 추가 */
export function appendToClaudeMd(
  target: 'global' | string, // 'global' 또는 프로젝트 경로
  type: AppliedCompoundItem['type'],
  text: string,
): { success: boolean; path: string; error?: string } {
  const mdPath = target === 'global'
    ? GLOBAL_CLAUDE_MD
    : join(target, '.claude', 'CLAUDE.md');

  // 디렉토리 보장
  const dir = dirname(mdPath);
  mkdirSync(dir, { recursive: true });

  let content = '';
  if (existsSync(mdPath)) {
    content = readFileSync(mdPath, 'utf-8');
  }

  const subsectionHeader = SUBSECTION_HEADERS[type];
  const bulletItem = type === 'goldenPrompt'
    ? `- 💡 "${text.slice(0, 150)}"`
    : `- ${text}`;

  try {
    const updated = insertIntoSection(content, subsectionHeader, bulletItem);
    atomicWriteSync(mdPath, updated);
    return { success: true, path: mdPath };
  } catch (err) {
    return { success: false, path: mdPath, error: String(err) };
  }
}

/**
 * CLAUDE.md 내용에서 Compound Insights 섹션을 찾거나 만들고,
 * 해당 서브섹션에 항목을 추가
 */
/** @internal 테스트용 export */
export function insertIntoSection(content: string, subsectionHeader: string, bulletItem: string): string {
  // 이미 동일한 내용이 있으면 중복 추가 방지
  if (content.includes(bulletItem)) {
    return content;
  }

  // Compound Insights 섹션이 없으면 파일 끝에 생성
  if (!content.includes(COMPOUND_SECTION_HEADER)) {
    const newSection = [
      '',
      COMPOUND_SECTION_HEADER,
      '',
      subsectionHeader,
      bulletItem,
      '',
    ].join('\n');
    return content.trimEnd() + '\n' + newSection;
  }

  // 서브섹션이 없으면 Compound Insights 섹션 끝에 추가
  if (!content.includes(subsectionHeader)) {
    // Compound Insights 다음 ## 섹션 또는 파일 끝 찾기
    const sectionStart = content.indexOf(COMPOUND_SECTION_HEADER);
    const afterSection = content.slice(sectionStart + COMPOUND_SECTION_HEADER.length);
    const nextH2 = afterSection.search(/\n## [^#]/);

    const insertPos = nextH2 !== -1
      ? sectionStart + COMPOUND_SECTION_HEADER.length + nextH2
      : content.length;

    const insertion = `\n${subsectionHeader}\n${bulletItem}\n`;
    return content.slice(0, insertPos) + insertion + content.slice(insertPos);
  }

  // 서브섹션이 있으면 그 안에 추가
  const subStart = content.indexOf(subsectionHeader);
  const afterSub = content.slice(subStart + subsectionHeader.length);
  // 다음 ### 또는 ## 또는 파일 끝
  const nextSection = afterSub.search(/\n###? [^#]/);

  const insertPos = nextSection !== -1
    ? subStart + subsectionHeader.length + nextSection
    : content.length;

  // 마지막 항목 뒤에 추가
  return content.slice(0, insertPos).trimEnd() + '\n' + bulletItem + '\n' + content.slice(insertPos);
}
