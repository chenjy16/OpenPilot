/**
 * Tests for PluginManager
 */

import { PluginManager } from './PluginManager';
import { Plugin, PluginContext } from './types';

function createMockContext(): PluginContext {
  return {
    toolExecutor: {} as any,
    config: {},
    log: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
}

function createMockPlugin(name: string, version = '1.0.0'): Plugin & { activated: boolean; deactivated: boolean } {
  const plugin: any = {
    manifest: { name, version, description: `Test plugin ${name}` },
    activated: false,
    deactivated: false,
    async activate() { plugin.activated = true; },
    async deactivate() { plugin.deactivated = true; },
  };
  return plugin;
}

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager(createMockContext());
  });

  describe('register', () => {
    it('should register and activate a plugin', async () => {
      const plugin = createMockPlugin('test-plugin');
      await manager.register(plugin);
      expect(plugin.activated).toBe(true);
      expect(manager.has('test-plugin')).toBe(true);
    });

    it('should throw if plugin already registered', async () => {
      const p1 = createMockPlugin('dup');
      const p2 = createMockPlugin('dup');
      await manager.register(p1);
      await expect(manager.register(p2)).rejects.toThrow("Plugin 'dup' is already registered");
    });

    it('should handle activation errors gracefully', async () => {
      const plugin = createMockPlugin('bad');
      plugin.activate = async () => { throw new Error('Activation failed'); };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      await manager.register(plugin);
      consoleSpy.mockRestore();

      const plugins = manager.getPlugins();
      expect(plugins[0].status).toBe('error');
      expect(plugins[0].error).toBe('Activation failed');
    });
  });

  describe('unregister', () => {
    it('should deactivate and remove a plugin', async () => {
      const plugin = createMockPlugin('test');
      await manager.register(plugin);
      await manager.unregister('test');
      expect(plugin.deactivated).toBe(true);
      expect(manager.has('test')).toBe(false);
    });

    it('should handle unregister of unknown plugin', async () => {
      await manager.unregister('nonexistent'); // Should not throw
    });
  });

  describe('getPlugins', () => {
    it('should return info about all plugins', async () => {
      await manager.register(createMockPlugin('a', '1.0.0'));
      await manager.register(createMockPlugin('b', '2.0.0'));

      const plugins = manager.getPlugins();
      expect(plugins).toHaveLength(2);
      expect(plugins[0].name).toBe('a');
      expect(plugins[0].version).toBe('1.0.0');
      expect(plugins[0].status).toBe('active');
      expect(plugins[1].name).toBe('b');
    });
  });

  describe('deactivateAll', () => {
    it('should deactivate all plugins', async () => {
      const p1 = createMockPlugin('a');
      const p2 = createMockPlugin('b');
      await manager.register(p1);
      await manager.register(p2);

      await manager.deactivateAll();

      expect(p1.deactivated).toBe(true);
      expect(p2.deactivated).toBe(true);
      expect(manager.getPlugins()).toHaveLength(0);
    });
  });
});
