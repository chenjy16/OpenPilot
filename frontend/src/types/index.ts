// ===== 会话相关 =====
export interface SessionSummary {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  isStreaming?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  result?: unknown;
  error?: string;
}

// ===== 浏览器控制 =====
export interface BrowserInstance {
  id: string;
  status: 'running' | 'idle' | 'error';
  currentUrl?: string;
  createdAt: string;
}

export interface AutomationAction {
  type: 'click' | 'input' | 'navigate' | 'extract' | 'download' | 'scrape';
  selector?: string;
  selectorType?: 'css' | 'xpath';
  value?: string;
  attribute?: string;
}

export interface RecordedScript {
  id: string;
  name: string;
  createdAt: string;
  steps: AutomationAction[];
}

// ===== 进程管理 =====
export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
}

// ===== 脚本执行 =====
export interface ScriptExecution {
  id: string;
  language: 'javascript' | 'python' | 'shell';
  content: string;
  stdout: string;
  stderr: string;
  executedAt: string;
  duration: number;
  status: 'success' | 'error' | 'timeout';
}

// ===== 资源监控 =====
export interface ResourceSnapshot {
  timestamp: number;
  cpu: { usage: number };
  memory: { heapUsed: number; heapTotal: number; rss: number; external: number };
  disk: { total: number; used: number; available: number };
  network: { name: string; address: string; family: string }[];
}

// ===== 安全与审计 =====
export interface AuditLogEntry {
  id: string;
  action: string;
  operator: string;
  timestamp: string;
  details: Record<string, unknown>;
  status: 'executed' | 'cancelled' | 'failed';
}

export type PermissionLevel = 'normal' | 'elevated' | 'admin';

// ===== 文件系统 =====
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  permissions?: string;
  children?: FileNode[];
}

// ===== 定时任务 =====
export interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  lastStatus?: 'success' | 'error';
}

export interface TaskExecution {
  id: string;
  taskId: string;
  executedAt: string;
  result: string;
  error?: string;
  status: 'success' | 'error';
}

// ===== 网络操作 =====
export interface HttpRequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  responseTime: number;
}

// ===== 邮件 =====
export interface EmailConfig {
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
  from: string;
  to: string[];
  subject: string;
  body: string;
  attachments?: { filename: string; path: string }[];
}

// ===== 数据库 =====
export interface DBQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;
}

// ===== 云服务 =====
export interface CloudFileOperation {
  type: 'upload' | 'download' | 'sync';
  localPath: string;
  remotePath: string;
  progress: number;
  speed: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

// ===== 系统配置 =====
export interface SystemInfo {
  os: { platform: string; release: string; arch: string };
  cpu: { model: string; cores: number; speed: number };
  memory: { total: number; free: number };
  network: { name: string; address: string }[];
  user: { username: string; homedir: string; shell: string };
}


// ===== 技能系统 =====
export interface SkillStatusReport {
  name: string;
  source: string;
  filePath: string;
  enabled: boolean;
  emoji?: string;
  homepage?: string;
  requirements?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  missing?: {
    bins: string[];
    env: string[];
    config: string[];
  };
  installSpecs?: SkillInstallSpec[];
}

export interface SkillInstallSpec {
  kind: 'brew' | 'node' | 'go' | 'uv' | 'download';
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  url?: string;
}

// ===== 社区技能 (ClawHub + SkillsMP) =====
export type CommunitySource = 'clawhub' | 'skillsmp';

export interface CommunitySkillResult {
  slug: string;
  name: string;
  description: string;
  repo: string;
  repoUrl: string;
  stars?: number;
  downloads?: number;
  author?: string;
  tags?: string[];
  updatedAt?: string;
  version?: string;
  source: CommunitySource;
}

export interface CommunitySkillDetail extends CommunitySkillResult {
  content: string;
  filePath: string;
  readme?: string;
  changelog?: string;
  security?: { status: string; hasWarnings?: boolean };
}

export interface CommunityInstallResult {
  ok: boolean;
  slug: string;
  installedPath: string;
  message: string;
}

// ===== 工具目录 =====
export interface ToolCatalogEntry {
  id: string;
  label: string;
  section: string;
  description: string;
  emoji: string;
  verb: string;
  profiles: string[];
  openclawGroup?: boolean;
  ownerOnly?: boolean;
}

export interface ToolSection {
  name: string;
  tools: ToolCatalogEntry[];
}

// ===== 智能体系统 =====
export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  model?: { primary: string; fallbacks?: string[] };
  toolProfile?: string;
  tools?: { allow?: string[]; deny?: string[]; alsoAllow?: string[] };
  skillFilter?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentIdentity {
  agentId: string;
  name: string;
  description?: string;
  emoji?: string;
  personality?: string;
}

// ===== 节点系统 =====
export interface NodeInfo {
  id: string;
  label: string;
  platform: string;
  status: 'online' | 'offline' | 'pairing';
  capabilities: string[];
  lastSeenAt?: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: string;
  status: 'paired' | 'pending' | 'revoked';
  pairedAt?: string;
}
