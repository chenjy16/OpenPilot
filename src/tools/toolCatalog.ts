/**
 * Tool Catalog — OpenClaw-aligned tool registry
 *
 * Defines 25 core tools across 11 sections, tool profiles,
 * tool groups, and display metadata.
 */

// ---------------------------------------------------------------------------
// Tool section / catalog types
// ---------------------------------------------------------------------------

export interface ToolCatalogEntry {
  id: string;
  label: string;
  section: string;
  description: string;
  emoji: string;
  verb: string;
  /** Included in which profiles */
  profiles: string[];
  /** Part of the openclaw group */
  openclawGroup?: boolean;
  /** Owner-only tool */
  ownerOnly?: boolean;
}

export interface ToolSection {
  name: string;
  tools: ToolCatalogEntry[];
}

export type ToolProfile = 'minimal' | 'coding' | 'messaging' | 'full';

// ---------------------------------------------------------------------------
// Core tool catalog (25 tools, 11 sections)
// ---------------------------------------------------------------------------

const CATALOG: ToolCatalogEntry[] = [
  // Files
  { id: 'read', label: 'read', section: 'Files', description: '读取文件内容', emoji: '📄', verb: 'Reading file', profiles: ['coding'] },
  { id: 'write', label: 'write', section: 'Files', description: '创建或覆盖文件', emoji: '✏️', verb: 'Writing file', profiles: ['coding'] },
  { id: 'edit', label: 'edit', section: 'Files', description: '精确编辑文件', emoji: '🔧', verb: 'Editing file', profiles: ['coding'] },
  { id: 'apply_patch', label: 'apply_patch', section: 'Files', description: '补丁文件 (OpenAI 格式)', emoji: '🩹', verb: 'Applying patch', profiles: ['coding'] },
  // Runtime
  { id: 'exec', label: 'exec', section: 'Runtime', description: '执行 shell 命令', emoji: '⚡', verb: 'Executing command', profiles: ['coding'] },
  { id: 'process', label: 'process', section: 'Runtime', description: '管理后台进程', emoji: '🔄', verb: 'Managing process', profiles: ['coding'] },
  // Web
  { id: 'web_search', label: 'web_search', section: 'Web', description: '网络搜索', emoji: '🔍', verb: 'Searching web', profiles: [], openclawGroup: true },
  { id: 'web_fetch', label: 'web_fetch', section: 'Web', description: '获取网页内容', emoji: '🌐', verb: 'Fetching URL', profiles: [], openclawGroup: true },
  // Memory
  { id: 'memory_search', label: 'memory_search', section: 'Memory', description: '语义搜索记忆', emoji: '🧠', verb: 'Searching memory', profiles: ['coding'], openclawGroup: true },
  { id: 'memory_get', label: 'memory_get', section: 'Memory', description: '读取记忆文件', emoji: '📝', verb: 'Reading memory', profiles: ['coding'], openclawGroup: true },
  // Sessions
  { id: 'sessions_list', label: 'sessions_list', section: 'Sessions', description: '列出会话', emoji: '📋', verb: 'Listing sessions', profiles: ['coding', 'messaging'], openclawGroup: true },
  { id: 'sessions_history', label: 'sessions_history', section: 'Sessions', description: '会话历史', emoji: '📜', verb: 'Reading history', profiles: ['coding', 'messaging'], openclawGroup: true },
  { id: 'sessions_send', label: 'sessions_send', section: 'Sessions', description: '发送到会话', emoji: '📤', verb: 'Sending message', profiles: ['coding', 'messaging'], openclawGroup: true },
  { id: 'sessions_spawn', label: 'sessions_spawn', section: 'Sessions', description: '生成子智能体', emoji: '🔀', verb: 'Spawning sub-agent', profiles: ['coding'], openclawGroup: true },
  { id: 'subagents', label: 'subagents', section: 'Sessions', description: '管理子智能体', emoji: '👥', verb: 'Managing sub-agents', profiles: ['coding'], openclawGroup: true },
  { id: 'session_status', label: 'session_status', section: 'Sessions', description: '会话状态', emoji: '📊', verb: 'Checking status', profiles: ['minimal', 'coding', 'messaging'], openclawGroup: true },
  // UI
  { id: 'browser', label: 'browser', section: 'UI', description: '控制浏览器', emoji: '🖥️', verb: 'Controlling browser', profiles: [], openclawGroup: true },
  { id: 'canvas', label: 'canvas', section: 'UI', description: '控制画布', emoji: '🎨', verb: 'Using canvas', profiles: [], openclawGroup: true },
  // Messaging
  { id: 'message', label: 'message', section: 'Messaging', description: '发送消息', emoji: '💬', verb: 'Sending message', profiles: ['messaging'], openclawGroup: true },
  // Automation
  { id: 'cron', label: 'cron', section: 'Automation', description: '定时任务调度', emoji: '⏰', verb: 'Scheduling task', profiles: ['coding'], openclawGroup: true, ownerOnly: true },
  { id: 'gateway', label: 'gateway', section: 'Automation', description: '网关控制', emoji: '🚪', verb: 'Controlling gateway', profiles: [], openclawGroup: true, ownerOnly: true },
  // Nodes
  { id: 'nodes', label: 'nodes', section: 'Nodes', description: '节点 + 设备控制', emoji: '🖥️', verb: 'Controlling node', profiles: [], openclawGroup: true },
  // Agents
  { id: 'agents_list', label: 'agents_list', section: 'Agents', description: '列出智能体', emoji: '🤖', verb: 'Listing agents', profiles: [], openclawGroup: true },
  // Media
  { id: 'image', label: 'image', section: 'Media', description: '图像理解', emoji: '🖼️', verb: 'Analyzing image', profiles: ['coding'], openclawGroup: true },
  { id: 'tts', label: 'tts', section: 'Media', description: '文本转语音', emoji: '🔊', verb: 'Generating speech', profiles: [], openclawGroup: true },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the full tool catalog grouped by section */
export function getToolCatalog(): ToolSection[] {
  const sections = new Map<string, ToolCatalogEntry[]>();
  for (const entry of CATALOG) {
    if (!sections.has(entry.section)) sections.set(entry.section, []);
    sections.get(entry.section)!.push(entry);
  }
  return Array.from(sections.entries()).map(([name, tools]) => ({ name, tools }));
}

/** Get all tool IDs */
export function getAllToolIds(): string[] {
  return CATALOG.map(e => e.id);
}

/** Get tool entry by ID */
export function getToolEntry(id: string): ToolCatalogEntry | undefined {
  return CATALOG.find(e => e.id === id);
}

/** Get tools for a given profile */
export function getToolsForProfile(profile: ToolProfile): string[] {
  if (profile === 'full') return CATALOG.map(e => e.id);
  return CATALOG.filter(e => e.profiles.includes(profile)).map(e => e.id);
}

// ---------------------------------------------------------------------------
// Tool groups
// ---------------------------------------------------------------------------

const SECTION_TO_GROUP: Record<string, string> = {
  Files: 'fs',
  Runtime: 'runtime',
  Web: 'web',
  Memory: 'memory',
  Sessions: 'sessions',
  UI: 'ui',
  Messaging: 'messaging',
  Automation: 'automation',
  Nodes: 'nodes',
  Agents: 'agents',
  Media: 'media',
};

/** Expand tool group references (e.g. "group:fs" → ["read","write","edit","apply_patch"]) */
export function expandToolGroups(list: string[]): string[] {
  const result: string[] = [];
  for (const item of list) {
    if (item.startsWith('group:')) {
      const groupName = item.slice(6);
      if (groupName === 'openclaw') {
        result.push(...CATALOG.filter(e => e.openclawGroup).map(e => e.id));
      } else {
        const sectionName = Object.entries(SECTION_TO_GROUP).find(([, g]) => g === groupName)?.[0];
        if (sectionName) {
          result.push(...CATALOG.filter(e => e.section === sectionName).map(e => e.id));
        }
      }
    } else {
      result.push(item);
    }
  }
  return [...new Set(result)];
}

/** Owner-only tool IDs */
export function getOwnerOnlyTools(): string[] {
  return CATALOG.filter(e => e.ownerOnly).map(e => e.id);
}

/** Get display info for a tool */
export function getToolDisplay(id: string): { emoji: string; label: string; verb: string } | undefined {
  const entry = CATALOG.find(e => e.id === id);
  if (!entry) return undefined;
  return { emoji: entry.emoji, label: entry.label, verb: entry.verb };
}

// ---------------------------------------------------------------------------
// Catalog ID ↔ ToolExecutor name mapping
// ---------------------------------------------------------------------------

/**
 * Maps catalog short IDs to actual ToolExecutor registered names.
 * This bridges the OpenClaw catalog naming convention with our implementation.
 */
const CATALOG_TO_EXECUTOR: Record<string, string> = {
  read: 'readFile',
  write: 'writeFile',
  edit: 'writeFile',        // edit is a variant of write
  apply_patch: 'applyPatch',
  exec: 'shellExecute',
  process: 'shellExecute',  // process management via shell
  web_search: 'httpRequest',
  web_fetch: 'httpRequest',
  memory_search: 'memorySearch',
  memory_get: 'memoryGet',
  browser: 'browserNavigate',
  subagents: 'spawnSubAgent',
  sessions_spawn: 'spawnSubAgent',
};

/** Resolve a catalog ID to the actual ToolExecutor tool name */
export function catalogIdToExecutorName(catalogId: string): string {
  return CATALOG_TO_EXECUTOR[catalogId] ?? catalogId;
}

/** Resolve a ToolExecutor name to its catalog ID (reverse lookup) */
export function executorNameToCatalogId(executorName: string): string | undefined {
  for (const [catId, execName] of Object.entries(CATALOG_TO_EXECUTOR)) {
    if (execName === executorName) return catId;
  }
  return undefined;
}

/**
 * Resolve a list of catalog IDs (possibly with group: prefixes) to
 * actual ToolExecutor names. Used by PolicyEngine and agent tool filtering.
 */
export function resolveToolNames(catalogIds: string[]): string[] {
  const expanded = expandToolGroups(catalogIds);
  return [...new Set(expanded.map(id => catalogIdToExecutorName(id)))];
}

/**
 * Get ToolExecutor names for a given profile.
 * Returns the actual registered tool names, not catalog IDs.
 */
export function getExecutorNamesForProfile(profile: ToolProfile): string[] {
  const catalogIds = getToolsForProfile(profile);
  return [...new Set(catalogIds.map(id => catalogIdToExecutorName(id)))];
}
