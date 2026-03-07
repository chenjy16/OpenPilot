/**
 * Plugin Manager
 *
 * Manages plugin lifecycle: discovery, loading, activation, deactivation.
 * OpenPilot equivalent: src/plugins/ runtime.
 */

import { Plugin, PluginContext, PluginInfo } from './types';

export class PluginManager {
  private plugins: Map<string, { plugin: Plugin; status: 'active' | 'inactive' | 'error'; error?: string }> = new Map();
  private context: PluginContext;

  constructor(context: PluginContext) {
    this.context = context;
  }

  /**
   * Register and activate a plugin.
   */
  async register(plugin: Plugin): Promise<void> {
    const { name } = plugin.manifest;
    if (this.plugins.has(name)) {
      throw new Error(`Plugin '${name}' is already registered`);
    }

    try {
      await plugin.activate({
        ...this.context,
        log: {
          info: (msg) => console.log(`[Plugin:${name}] ${msg}`),
          warn: (msg) => console.warn(`[Plugin:${name}] ${msg}`),
          error: (msg) => console.error(`[Plugin:${name}] ${msg}`),
        },
      });
      this.plugins.set(name, { plugin, status: 'active' });
    } catch (err: any) {
      this.plugins.set(name, { plugin, status: 'error', error: err.message });
      console.error(`[PluginManager] Failed to activate '${name}': ${err.message}`);
    }
  }

  /**
   * Deactivate and remove a plugin.
   */
  async unregister(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) return;

    try {
      await entry.plugin.deactivate?.();
    } catch { /* ignore */ }
    this.plugins.delete(name);
  }

  /**
   * Deactivate all plugins.
   */
  async deactivateAll(): Promise<void> {
    for (const [name] of this.plugins) {
      await this.unregister(name);
    }
  }

  /**
   * Get info about all registered plugins.
   */
  getPlugins(): PluginInfo[] {
    return Array.from(this.plugins.entries()).map(([, entry]) => ({
      name: entry.plugin.manifest.name,
      version: entry.plugin.manifest.version,
      description: entry.plugin.manifest.description,
      status: entry.status,
      error: entry.error,
    }));
  }

  /**
   * Check if a plugin is registered.
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }
}
