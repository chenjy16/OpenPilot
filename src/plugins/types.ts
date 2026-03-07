/**
 * Plugin System Types
 *
 * OpenPilot-aligned plugin SDK types.
 * Plugins can register: tools, channels, hooks, and middleware.
 */

import { ToolExecutor } from '../tools/ToolExecutor';

export interface PluginContext {
  /** Register tools with the executor */
  toolExecutor: ToolExecutor;
  /** Plugin configuration from config file */
  config: Record<string, any>;
  /** Logger scoped to this plugin */
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

export interface PluginManifest {
  /** Unique plugin identifier */
  name: string;
  /** Semver version */
  version: string;
  /** Human-readable description */
  description?: string;
  /** Plugin author */
  author?: string;
  /** Plugin entry point (relative to plugin dir) */
  main?: string;
}

export interface Plugin {
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Called when the plugin is loaded */
  activate(ctx: PluginContext): Promise<void>;
  /** Called when the plugin is unloaded */
  deactivate?(): Promise<void>;
}

export type PluginFactory = () => Plugin;

export interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  status: 'active' | 'inactive' | 'error';
  error?: string;
}
