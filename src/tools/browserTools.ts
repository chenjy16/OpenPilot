/**
 * Browser Automation Tools
 *
 * Lightweight Playwright-based browser tools for the Agent.
 * OpenPilot equivalent: browser_* tool family.
 *
 * Tools:
 *   - browserNavigate: Navigate to a URL and return page content
 *   - browserScreenshot: Take a screenshot of the current page
 *   - browserClick: Click an element by CSS selector
 *   - browserEvaluate: Execute JavaScript in the page context
 *
 * Playwright is lazy-loaded to avoid startup cost when browser tools
 * are not used. If playwright is not installed, tools return a clear error.
 */

import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';

// Lazy-loaded playwright references
let browserInstance: any = null;
let pageInstance: any = null;

/**
 * Get or launch a browser + page. Reuses across calls.
 */
async function getPage(): Promise<any> {
  if (pageInstance) return pageInstance;

  let playwright: any;
  try {
    playwright = require('playwright-core');
  } catch {
    try {
      playwright = require('playwright');
    } catch {
      throw new Error(
        'Playwright is not installed. Run: npm install playwright-core\n' +
        'Then install a browser: npx playwright install chromium',
      );
    }
  }

  browserInstance = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browserInstance.newContext({
    userAgent: 'OpenPilot-Agent/1.0',
    viewport: { width: 1280, height: 720 },
  });
  pageInstance = await context.newPage();
  return pageInstance;
}

/**
 * Close the browser instance (for cleanup).
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
    pageInstance = null;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const browserNavigateTool: Tool = {
  name: 'browserNavigate',
  description: 'Navigate to a URL and return the page title and text content (truncated to 8000 chars).',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to navigate to' },
      waitForSelector: {
        type: 'string',
        description: 'Optional CSS selector to wait for before extracting content',
      },
    },
    required: ['url'],
  },
  execute: async (params: Record<string, unknown>) => {
    const url = params.url as string;
    const waitFor = params.waitForSelector as string | undefined;

    // Validate URL
    try { new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }

    const page = await getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 10_000 }).catch(() => {});
    }

    const title = await page.title();
    const text: string = await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      return (globalThis as any).document?.body?.innerText ?? '';
    });

    // Truncate to avoid blowing up context
    const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n[...truncated]' : text;

    return { url: page.url(), title, content: truncated };
  },
};

export const browserScreenshotTool: Tool = {
  name: 'browserScreenshot',
  description: 'Take a screenshot of the current browser page. Returns a base64-encoded PNG.',
  parameters: {
    type: 'object',
    properties: {
      fullPage: {
        type: 'boolean',
        description: 'Whether to capture the full scrollable page (default: false)',
      },
    },
  },
  execute: async (params: Record<string, unknown>) => {
    const fullPage = (params.fullPage as boolean) ?? false;
    const page = await getPage();
    const buffer: Buffer = await page.screenshot({ fullPage, type: 'png' });
    return {
      format: 'png',
      base64: buffer.toString('base64'),
      url: page.url(),
    };
  },
};

export const browserClickTool: Tool = {
  name: 'browserClick',
  description: 'Click an element on the current page by CSS selector.',
  parameters: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector of the element to click' },
    },
    required: ['selector'],
  },
  execute: async (params: Record<string, unknown>) => {
    const selector = params.selector as string;
    const page = await getPage();
    await page.click(selector, { timeout: 10_000 });
    // Return updated page info after click
    const title = await page.title();
    return { clicked: selector, url: page.url(), title };
  },
};

export const browserEvaluateTool: Tool = {
  name: 'browserEvaluate',
  description: 'Execute JavaScript code in the browser page context and return the result.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code to evaluate in the page' },
    },
    required: ['code'],
  },
  execute: async (params: Record<string, unknown>) => {
    const code = params.code as string;
    const page = await getPage();
    // Wrap in try-catch to return errors as structured data
    try {
      const result = await page.evaluate(code);
      return { result: result ?? null };
    } catch (err: any) {
      return { error: err.message ?? String(err) };
    }
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register browser automation tools with the given ToolExecutor.
 */
export function registerBrowserTools(executor: ToolExecutor): void {
  executor.register(browserNavigateTool);
  executor.register(browserScreenshotTool);
  executor.register(browserClickTool);
  executor.register(browserEvaluateTool);
}
