/**
 * Tests for CLI commands
 */

import { runDoctor, checkStatus } from './index';

describe('CLI Commands', () => {
  describe('runDoctor', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return diagnostic checks', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const checks = await runDoctor();
      expect(checks.length).toBeGreaterThan(0);

      // Node.js version check should pass
      const nodeCheck = checks.find(c => c.name === 'Node.js version');
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck!.status).toBe('ok');
    });

    it('should detect missing API keys', async () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;

      const checks = await runDoctor();
      const keyCheck = checks.find(c => c.name === 'API keys');
      expect(keyCheck).toBeDefined();
      expect(keyCheck!.status).toBe('error');
    });

    it('should detect configured API keys', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

      const checks = await runDoctor();
      const keyCheck = checks.find(c => c.name === 'API keys');
      expect(keyCheck!.status).toBe('ok');
      expect(keyCheck!.message).toContain('2 provider(s)');
    });
  });

  describe('checkStatus', () => {
    it('should report stopped when no server is running', async () => {
      // Use a port that's unlikely to be in use
      const result = await checkStatus(59999);
      expect(result.server).toBe('stopped');
      expect(result.port).toBe(59999);
    });
  });
});
