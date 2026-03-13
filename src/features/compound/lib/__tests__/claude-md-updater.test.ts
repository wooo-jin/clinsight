import { describe, it, expect } from 'vitest';
import { insertIntoSection } from '../claude-md-updater.js';

const SECTION_HEADER = '## Compound Insights';

describe('insertIntoSection', () => {
  it('빈 파일에 섹션과 서브섹션을 생성한다', () => {
    const result = insertIntoSection('', '### 솔루션', '- 테스트 솔루션');
    expect(result).toContain(SECTION_HEADER);
    expect(result).toContain('### 솔루션');
    expect(result).toContain('- 테스트 솔루션');
  });

  it('기존 내용이 있는 파일에 섹션을 추가한다', () => {
    const content = '# My Project\n\nSome content here.';
    const result = insertIntoSection(content, '### 패턴', '- 패턴 1');
    expect(result).toContain('# My Project');
    expect(result).toContain(SECTION_HEADER);
    expect(result).toContain('### 패턴');
    expect(result).toContain('- 패턴 1');
  });

  it('Compound Insights 섹션이 있으면 서브섹션을 추가한다', () => {
    const content = `# Project\n\n${SECTION_HEADER}\n\n### 패턴\n- 기존 패턴`;
    const result = insertIntoSection(content, '### 솔루션', '- 새 솔루션');
    expect(result).toContain('### 솔루션');
    expect(result).toContain('- 새 솔루션');
    expect(result).toContain('- 기존 패턴');
  });

  it('서브섹션이 이미 있으면 그 안에 항목을 추가한다', () => {
    const content = `${SECTION_HEADER}\n\n### 솔루션\n- 기존 솔루션`;
    const result = insertIntoSection(content, '### 솔루션', '- 추가 솔루션');
    expect(result).toContain('- 기존 솔루션');
    expect(result).toContain('- 추가 솔루션');
  });

  it('동일한 내용이 이미 있으면 중복 추가하지 않는다', () => {
    const content = `${SECTION_HEADER}\n\n### 솔루션\n- 기존 솔루션`;
    const result = insertIntoSection(content, '### 솔루션', '- 기존 솔루션');
    expect(result).toBe(content);
  });

  it('다른 ## 섹션 앞에 서브섹션을 삽입한다', () => {
    const content = `${SECTION_HEADER}\n\n### 패턴\n- p1\n\n## Other Section\n\nOther content`;
    const result = insertIntoSection(content, '### 솔루션', '- s1');
    // 솔루션이 Other Section 앞에 삽입되어야 함
    const solIdx = result.indexOf('### 솔루션');
    const otherIdx = result.indexOf('## Other Section');
    expect(solIdx).toBeGreaterThan(-1);
    expect(otherIdx).toBeGreaterThan(-1);
    expect(solIdx).toBeLessThan(otherIdx);
  });

  it('서브섹션 간 순서를 유지한다', () => {
    const content = `${SECTION_HEADER}\n\n### 패턴\n- p1\n\n### 컨벤션\n- c1`;
    const result = insertIntoSection(content, '### 패턴', '- p2');
    // p2가 패턴 섹션에 추가되고 컨벤션 앞에 있어야 함
    const p2Idx = result.indexOf('- p2');
    const convIdx = result.indexOf('### 컨벤션');
    expect(p2Idx).toBeGreaterThan(-1);
    expect(convIdx).toBeGreaterThan(-1);
    expect(p2Idx).toBeLessThan(convIdx);
  });
});
