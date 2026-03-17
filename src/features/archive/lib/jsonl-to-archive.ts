/**
 * JSONL 세션 파일을 ArchivedMessage 배열로 변환
 * 세션 종료 시 호출되어 완전한 대화 기록을 생성
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type {
  ProjectMessage,
  ProjectUserMessage,
  ProjectAssistantMessage,
  ContentBlock,
} from '../../../shared/types/session.js';
import type { ArchivedMessage, ToolResult } from './archive-writer.js';
import { PROJECTS_DIR, MAX_JSONL_SIZE } from '../../../shared/lib/constants.js';
import { readFileSafe } from '../../../shared/lib/fs-utils.js';

/** JSONL 파일에서 메시지 파싱 */
function parseJsonlMessages(filePath: string): ProjectMessage[] {
  if (!existsSync(filePath)) return [];
  const lines = readFileSafe(filePath, MAX_JSONL_SIZE).content.split('\n').filter(Boolean);
  const messages: ProjectMessage[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as ProjectMessage;
      if (obj.type === 'user' || obj.type === 'assistant') {
        messages.push(obj);
      }
    } catch { continue; }
  }
  return messages;
}

/** user content에서 텍스트 추출 */
function extractUserText(msg: ProjectUserMessage): string {
  const content = msg.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

/** tool_result content에서 텍스트 추출 */
function extractToolResultText(content: string | ContentBlock[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

/** assistant content에서 전체 원본 텍스트 추출 (자르기/요약 없이 그대로) */
function extractAssistantContent(msg: ProjectAssistantMessage): {
  text: string;
  toolUses: string[];
  toolResults: ToolResult[];
} {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return { text: '', toolUses: [], toolResults: [] };

  const contentParts: string[] = [];
  const toolUses: string[] = [];
  const toolResults: ToolResult[] = [];

  // tool_use ID → name 매핑 (tool_result와 연결용)
  const toolIdMap = new Map<string, { name: string; input?: Record<string, unknown> }>();

  for (const block of content) {
    if (block.type === 'thinking' && block.thinking) {
      contentParts.push(block.thinking);
    } else if (block.type === 'text' && block.text) {
      contentParts.push(block.text);
    } else if (block.type === 'tool_use' && block.name) {
      toolUses.push(block.name);
      if (block.id) {
        toolIdMap.set(block.id, { name: block.name, input: block.input });
      }
      // 도구 호출 input 원본 그대로 저장
      const inputStr = block.input ? JSON.stringify(block.input) : '';
      contentParts.push(`[${block.name}] ${inputStr}`);
    } else if (block.type === 'tool_result' && block.id) {
      const toolInfo = toolIdMap.get(block.id);
      const output = extractToolResultText(block.content);
      if (toolInfo) {
        toolResults.push({
          name: toolInfo.name,
          input: toolInfo.input,
          output: output || undefined,
        });
        if (output) {
          contentParts.push(`[${toolInfo.name} result] ${output}`);
        }
      }
    }
  }

  return { text: contentParts.join('\n'), toolUses, toolResults };
}

/** 세션 ID로 JSONL 파일 경로 찾기 */
export function findJsonlPath(sessionId: string): string | null {
  if (!existsSync(PROJECTS_DIR)) return null;

  for (const dirName of readdirSync(PROJECTS_DIR)) {
    const dirPath = join(PROJECTS_DIR, dirName);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch { continue; }

    const filePath = join(dirPath, `${sessionId}.jsonl`);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

/** JSONL → ArchivedMessage[] 변환 */
export function jsonlToMessages(filePath: string): ArchivedMessage[] {
  const rawMessages = parseJsonlMessages(filePath);
  const archived: ArchivedMessage[] = [];

  for (const msg of rawMessages) {
    if (msg.type === 'user') {
      const userMsg = msg as ProjectUserMessage;
      const text = extractUserText(userMsg);
      if (text) {
        archived.push({
          role: 'user',
          content: text,
          timestamp: userMsg.timestamp,
        });
      }
    } else if (msg.type === 'assistant') {
      const assistantMsg = msg as ProjectAssistantMessage;
      const { text, toolUses, toolResults } = extractAssistantContent(assistantMsg);
      if (text || toolUses.length > 0) {
        archived.push({
          role: 'assistant',
          content: text,
          timestamp: assistantMsg.timestamp,
          ...(toolUses.length > 0 ? { toolUses } : {}),
          ...(toolResults.length > 0 ? { toolResults } : {}),
        });
      }
    }
  }

  return archived;
}

/** JSONL에서 기본 메타데이터 추출 (project, model 등) — 앞부분 16KB만 읽어 메모리 절약 */
export function extractJsonlMeta(filePath: string): {
  project: string;
  model: string;
} {
  let project = 'unknown';
  let model = 'unknown';

  // project(cwd)와 model은 보통 JSONL 앞부분에 있으므로 16KB이면 충분
  const { content } = readFileSafe(filePath, 16 * 1024);
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'user' && obj.cwd && project === 'unknown') {
        project = obj.cwd;
      }
      if (obj.type === 'assistant' && obj.message?.model && model === 'unknown') {
        model = obj.message.model;
      }
      if (project !== 'unknown' && model !== 'unknown') break;
    } catch { continue; }
  }

  return { project, model };
}
