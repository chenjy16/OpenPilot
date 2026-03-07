/**
 * CLI Command System
 *
 * OpenPilot-aligned CLI commands for diagnostics and management.
 * Commands: status, doctor, config
 */

import * as http from 'http';

// ---------------------------------------------------------------------------
// Status command
// ---------------------------------------------------------------------------

export interface StatusResult {
  server: 'running' | 'stopped' | 'unknown';
  port: number;
  uptime?: string;
  models: string[];
  channels: string[];
  sessions?: number;
  plugins?: string[];
}

/**
 * Check the status of a running server instance.
 */
export async function checkStatus(port: number = 3000): Promise<StatusResult> {
  const result: StatusResult = {
    server: 'unknown',
    port,
    models: [],
    channels: [],
  };

  try {
    const health = await httpGet(`http://localhost:${port}/api/health`);
    if (health.status === 'ok') {
      result.server = 'running';
    }
  } catch {
    result.server = 'stopped';
  }

  if (result.server === 'running') {
    try {
      const channels = await httpGet(`http://localhost:${port}/api/channels`);
      if (Array.isArray(channels)) {
        result.channels = channels.map((c: any) => `${c.type}:${c.status}`);
      }
    } catch { /* ignore */ }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Doctor command
// ---------------------------------------------------------------------------

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

/**
 * Run diagnostic checks on the system.
 */
export async function runDoctor(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    name: 'Node.js version',
    status: major >= 18 ? 'ok' : 'error',
    message: major >= 18 ? `${nodeVersion} (OK)` : `${nodeVersion} (requires >=18)`,
  });

  // 2. API keys
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasGoogle = !!process.env.GOOGLE_AI_API_KEY;
  const keyCount = [hasOpenAI, hasAnthropic, hasGoogle].filter(Boolean).length;
  checks.push({
    name: 'API keys',
    status: keyCount > 0 ? 'ok' : 'error',
    message: keyCount > 0
      ? `${keyCount} provider(s) configured: ${[hasOpenAI && 'OpenAI', hasAnthropic && 'Anthropic', hasGoogle && 'Google'].filter(Boolean).join(', ')}`
      : 'No API keys set. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY.',
  });

  // 3. Database directory
  const fs = await import('fs');
  const dbDir = process.env.DATABASE_PATH ? require('path').dirname(process.env.DATABASE_PATH) : './data';
  checks.push({
    name: 'Database directory',
    status: fs.existsSync(dbDir) ? 'ok' : 'warn',
    message: fs.existsSync(dbDir) ? `${dbDir} exists` : `${dbDir} does not exist (will be created on start)`,
  });

  // 4. Optional: Playwright
  try {
    require.resolve('playwright');
    checks.push({ name: 'Playwright', status: 'ok', message: 'Installed (browser tools available)' });
  } catch {
    checks.push({ name: 'Playwright', status: 'warn', message: 'Not installed (browser tools will be unavailable)' });
  }

  // 5. Optional: grammy
  try {
    require.resolve('grammy');
    checks.push({ name: 'grammy', status: 'ok', message: 'Installed (Telegram channel available)' });
  } catch {
    checks.push({ name: 'grammy', status: 'warn', message: 'Not installed (Telegram channel unavailable)' });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}
