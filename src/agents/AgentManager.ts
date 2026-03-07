/**
 * Agent Manager — manages agent configurations, files, and identity
 *
 * Aligned with OpenClaw ui/src/ui/controllers/agents.ts
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  AgentInfo,
  AgentIdentity,
  AGENT_WORKSPACE_FILES,
  AgentWorkspaceFile,
} from './types';

const AGENTS_DIR = path.join(os.homedir(), '.openpilot', 'agents');
const DEFAULT_AGENT_ID = 'default';

export class AgentManager {
  private agentsDir: string;
  private agents: Map<string, AgentInfo> = new Map();

  constructor(agentsDir?: string) {
    this.agentsDir = agentsDir || AGENTS_DIR;
  }

  async initialize(): Promise<void> {
    await this.ensureDir(this.agentsDir);
    await this.ensureDefaultAgent();
    await this.loadAgents();
  }

  // -----------------------------------------------------------------------
  // Agent CRUD
  // -----------------------------------------------------------------------

  async listAgents(): Promise<AgentInfo[]> {
    return Array.from(this.agents.values());
  }

  async getAgent(agentId: string): Promise<AgentInfo | undefined> {
    return this.agents.get(agentId);
  }

  async createAgent(info: Partial<AgentInfo> & { id: string }): Promise<AgentInfo> {
    const now = new Date().toISOString();
    const agent: AgentInfo = {
      name: info.id,
      description: '',
      createdAt: now,
      updatedAt: now,
      ...info,
    };

    const agentDir = path.join(this.agentsDir, agent.id);
    await this.ensureDir(agentDir);

    // Write config
    await fs.writeFile(
      path.join(agentDir, 'agent.json'),
      JSON.stringify(agent, null, 2),
    );

    this.agents.set(agent.id, agent);
    return agent;
  }

  async updateAgent(agentId: string, updates: Partial<AgentInfo>): Promise<AgentInfo | undefined> {
    const existing = this.agents.get(agentId);
    if (!existing) return undefined;

    const updated: AgentInfo = {
      ...existing,
      ...updates,
      id: agentId, // prevent ID change
      updatedAt: new Date().toISOString(),
    };

    const agentDir = path.join(this.agentsDir, agentId);
    await fs.writeFile(
      path.join(agentDir, 'agent.json'),
      JSON.stringify(updated, null, 2),
    );

    this.agents.set(agentId, updated);
    return updated;
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    // Prevent deleting the default agent
    if (agentId === DEFAULT_AGENT_ID) return false;
    if (!this.agents.has(agentId)) return false;

    const agentDir = path.join(this.agentsDir, agentId);
    try {
      await fs.rm(agentDir, { recursive: true, force: true });
    } catch { /* directory may not exist */ }

    this.agents.delete(agentId);
    return true;
  }

  // -----------------------------------------------------------------------
  // Agent files (AGENTS.md, SOUL.md, etc.)
  // -----------------------------------------------------------------------

  async listFiles(agentId: string): Promise<string[]> {
    const agentDir = path.join(this.agentsDir, agentId);
    try {
      const entries = await fs.readdir(agentDir);
      return entries.filter(f => AGENT_WORKSPACE_FILES.includes(f as AgentWorkspaceFile) || f === 'agent.json');
    } catch {
      return [];
    }
  }

  async getFile(agentId: string, filename: string): Promise<string | null> {
    const filePath = path.join(this.agentsDir, agentId, filename);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async setFile(agentId: string, filename: string, content: string): Promise<void> {
    const agentDir = path.join(this.agentsDir, agentId);
    await this.ensureDir(agentDir);
    await fs.writeFile(path.join(agentDir, filename), content, 'utf-8');
  }

  // -----------------------------------------------------------------------
  // Agent identity
  // -----------------------------------------------------------------------

  async getIdentity(agentId: string): Promise<AgentIdentity | null> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // Try reading IDENTITY.md for extended info
    const identityContent = await this.getFile(agentId, 'IDENTITY.md');

    return {
      agentId,
      name: agent.name,
      description: agent.description,
      personality: identityContent || undefined,
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async ensureDir(dir: string): Promise<void> {
    try { await fs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
  }

  private async ensureDefaultAgent(): Promise<void> {
    const defaultDir = path.join(this.agentsDir, DEFAULT_AGENT_ID);
    const configPath = path.join(defaultDir, 'agent.json');
    try {
      await fs.access(configPath);
    } catch {
      await this.createAgent({
        id: DEFAULT_AGENT_ID,
        name: 'Default Agent',
        description: 'The default OpenPilot agent',
        toolProfile: 'coding',
      });
    }
  }

  private async loadAgents(): Promise<void> {
    try {
      const entries = await fs.readdir(this.agentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const configPath = path.join(this.agentsDir, entry.name, 'agent.json');
        try {
          const raw = await fs.readFile(configPath, 'utf-8');
          const agent: AgentInfo = JSON.parse(raw);
          this.agents.set(entry.name, agent);
        } catch { /* skip invalid */ }
      }
    } catch { /* dir doesn't exist yet */ }
  }
}
