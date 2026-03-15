import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import en from '../i18n/locales/en';
import zh from '../i18n/locales/zh';

/**
 * Recursively extract all dot-path keys from a nested object.
 * e.g. { a: { b: 'x', c: { d: 'y' } } } => ['a.b', 'a.c.d']
 */
function extractDotPathKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...extractDotPathKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/**
 * Feature: frontend-i18n-completion, Property 1: Locale key structural parity
 * Validates: Requirements 1.2, 1.3, 2.3, 2.4, 8.4, 9.1, 9.2
 */
describe('Property 1: Locale key structural parity', () => {
  const enKeys = new Set(extractDotPathKeys(en));
  const zhKeys = new Set(extractDotPathKeys(zh));
  const allKeys = Array.from(new Set([...enKeys, ...zhKeys]));

  it('en.ts and zh.ts have the exact same set of dot-path keys', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allKeys),
        (key: string) => {
          const inEn = enKeys.has(key);
          const inZh = zhKeys.has(key);
          expect(inEn).toBe(true);
          expect(inZh).toBe(true);
        },
      ),
      { numRuns: Math.max(100, allKeys.length) },
    );
  });

  it('en key count equals zh key count', () => {
    expect(enKeys.size).toBe(zhKeys.size);
  });

  it('no keys exist only in en', () => {
    const onlyInEn = [...enKeys].filter((k) => !zhKeys.has(k));
    expect(onlyInEn).toEqual([]);
  });

  it('no keys exist only in zh', () => {
    const onlyInZh = [...zhKeys].filter((k) => !enKeys.has(k));
    expect(onlyInZh).toEqual([]);
  });
});

/**
 * Strip single-line comments (// ...), multi-line comments (/* ... * /),
 * and console.* calls from source code so they are not scanned for Chinese characters.
 */
function stripCommentsAndConsole(source: string): string {
  // Remove multi-line comments
  let result = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments
  result = result.replace(/\/\/.*$/gm, '');
  // Remove console.* calls (handles multi-line by matching balanced parens simply)
  result = result.replace(/console\.\w+\([^)]*\)/g, '');
  return result;
}

/**
 * Feature: frontend-i18n-completion, Property 2: No hardcoded Chinese in migrated component source files
 * Validates: Requirements 1.1, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5
 */
describe('Property 2: No hardcoded Chinese in migrated component source files', () => {
  const fs = require('fs');
  const path = require('path');

  const componentFiles = [
    'components/charts/KlineChart.tsx',
    'components/chat/ChatInput.tsx',
    'components/chat/ToolCallMessage.tsx',
    'components/common/LanguageSwitcher.tsx',
    'components/session/SessionList.tsx',
    'components/views/AgentsView.tsx',
    'components/views/SkillsView.tsx',
    'components/views/TradingDashboardView.tsx',
    'components/views/AutoTradingPanel.tsx',
    'components/views/PerformanceView.tsx',
    'components/views/LiveDashboardView.tsx',
    'components/views/PolymarketView.tsx',
    'components/views/StockAnalysisView.tsx',
    'components/views/ChannelsView.tsx',
    'components/views/NodesView.tsx',
    'components/views/DebugView.tsx',
    'components/views/LogsView.tsx',
    'components/views/ModelsView.tsx',
    'components/views/SessionsView.tsx',
    'components/views/UsageView.tsx',
  ];

  const frontendRoot = path.resolve(__dirname, '..');
  const chineseCharRegex = /[\u4e00-\u9fff]/g;

  it('no migrated component file contains hardcoded Chinese outside comments and console calls', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...componentFiles),
        (filePath: string) => {
          const fullPath = path.resolve(frontendRoot, filePath);
          const source = fs.readFileSync(fullPath, 'utf-8');
          const stripped = stripCommentsAndConsole(source);
          const matches = stripped.match(chineseCharRegex);
          expect(matches).toBeNull();
        },
      ),
      { numRuns: Math.max(100, componentFiles.length * 5) },
    );
  });
});


/**
 * Extract all section keys (top-level) and leaf keys (second-level) from a locale object.
 * Returns { sectionKeys, leafKeys, allDotPaths } where allDotPaths includes the nesting depth.
 */
function extractKeyInfo(obj: Record<string, unknown>): {
  sectionKeys: string[];
  leafKeys: string[];
  allDotPaths: { path: string; depth: number }[];
} {
  const sectionKeys: string[] = [];
  const leafKeys: string[] = [];
  const allDotPaths: { path: string; depth: number }[] = [];

  for (const sectionKey of Object.keys(obj)) {
    sectionKeys.push(sectionKey);
    const section = obj[sectionKey];
    if (typeof section === 'object' && section !== null && !Array.isArray(section)) {
      for (const leafKey of Object.keys(section as Record<string, unknown>)) {
        const value = (section as Record<string, unknown>)[leafKey];
        if (typeof value === 'string') {
          leafKeys.push(leafKey);
          allDotPaths.push({ path: `${sectionKey}.${leafKey}`, depth: 2 });
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // 3rd level nesting (e.g., kline.timeframe.daily)
          for (const subKey of Object.keys(value as Record<string, unknown>)) {
            leafKeys.push(subKey);
            allDotPaths.push({ path: `${sectionKey}.${leafKey}.${subKey}`, depth: 3 });
          }
        }
      }
    }
  }

  return { sectionKeys, leafKeys, allDotPaths };
}

/**
 * Feature: frontend-i18n-completion, Property 3: Locale key naming convention
 * Validates: Requirements 8.1, 8.2
 */
describe('Property 3: Locale key naming convention', () => {
  const camelCaseRegex = /^[a-z][a-zA-Z0-9]*$/;
  const enInfo = extractKeyInfo(en);
  const allSectionKeys = [...new Set(enInfo.sectionKeys)];
  const allLeafKeys = [...new Set(enInfo.leafKeys)];
  const allDotPaths = enInfo.allDotPaths;

  it('all section keys (top-level) are camelCase', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allSectionKeys),
        (sectionKey: string) => {
          expect(sectionKey).toMatch(camelCaseRegex);
        },
      ),
      { numRuns: Math.max(100, allSectionKeys.length) },
    );
  });

  it('all leaf keys (second/third level) are camelCase', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allLeafKeys),
        (leafKey: string) => {
          expect(leafKey).toMatch(camelCaseRegex);
        },
      ),
      { numRuns: Math.max(100, allLeafKeys.length) },
    );
  });

  it('all keys are at exactly 2 levels of nesting, except kline.timeframe which has 3', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allDotPaths),
        (entry: { path: string; depth: number }) => {
          if (entry.depth === 3) {
            // Only kline.timeframe is allowed to have 3 levels
            expect(entry.path.startsWith('kline.timeframe.')).toBe(true);
          } else {
            expect(entry.depth).toBe(2);
          }
        },
      ),
      { numRuns: Math.max(100, allDotPaths.length) },
    );
  });

  it('all leaf values are strings (no deeper nesting beyond allowed exceptions)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allDotPaths),
        (entry: { path: string; depth: number }) => {
          // Navigate to the value
          const parts = entry.path.split('.');
          let current: unknown = en;
          for (const part of parts) {
            current = (current as Record<string, unknown>)[part];
          }
          expect(typeof current).toBe('string');
        },
      ),
      { numRuns: Math.max(100, allDotPaths.length) },
    );
  });
});

/**
 * Extract all translation value strings from a locale object (handles 2 and 3 levels of nesting).
 */
function extractAllValues(obj: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const sectionKey of Object.keys(obj)) {
    const section = obj[sectionKey];
    if (typeof section === 'object' && section !== null && !Array.isArray(section)) {
      for (const leafKey of Object.keys(section as Record<string, unknown>)) {
        const value = (section as Record<string, unknown>)[leafKey];
        if (typeof value === 'string') {
          values.push(value);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          for (const subKey of Object.keys(value as Record<string, unknown>)) {
            const subValue = (value as Record<string, unknown>)[subKey];
            if (typeof subValue === 'string') {
              values.push(subValue);
            }
          }
        }
      }
    }
  }
  return values;
}

/**
 * Feature: frontend-i18n-completion, Property 4: Interpolation syntax consistency
 * Validates: Requirements 8.3
 */
describe('Property 4: Interpolation syntax consistency', () => {
  const enValues = extractAllValues(en);
  const zhValues = extractAllValues(zh);
  const allValues = [...new Set([...enValues, ...zhValues])];

  // Filter to only values that contain { or }
  const valuesWithBraces = allValues.filter((v) => v.includes('{') || v.includes('}'));

  // Valid i18next interpolation pattern: {{variableName}}
  const validInterpolationRegex = /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g;

  // Forbidden alternative interpolation patterns
  const forbiddenPatterns = [
    { pattern: /%s/, name: '%s (printf string)' },
    { pattern: /%d/, name: '%d (printf digit)' },
    { pattern: /\{(\d+)\}/, name: '{0} (positional)' },
    { pattern: /\$\{[^}]*\}/, name: '${...} (template literal)' },
  ];

  it('all translation values with braces use {{variable}} interpolation syntax', () => {
    // Ensure we have values to test
    expect(valuesWithBraces.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...valuesWithBraces),
        (value: string) => {
          // After removing all valid {{variable}} patterns, no stray single { or } should remain
          // (except as part of emoji or non-interpolation text)
          const stripped = value.replace(validInterpolationRegex, '');
          // Check that no single curly braces remain that look like interpolation attempts
          const singleBraceInterpolation = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;
          expect(singleBraceInterpolation.test(stripped)).toBe(false);
        },
      ),
      { numRuns: Math.max(100, valuesWithBraces.length) },
    );
  });

  it('no translation values use forbidden interpolation patterns', () => {
    expect(allValues.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...allValues),
        (value: string) => {
          for (const { pattern } of forbiddenPatterns) {
            expect(pattern.test(value)).toBe(false);
          }
        },
      ),
      { numRuns: Math.max(100, allValues.length) },
    );
  });
});



/**
 * Resolve a dot-path key to its value in a nested locale object.
 * e.g. getNestedValue({ a: { b: 'hello' } }, 'a.b') => 'hello'
 */
function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Feature: frontend-i18n-completion, Property 5: Language switch round-trip
 * Validates: Requirements 10.1
 */
describe('Property 5: Language switch round-trip', () => {
  const i18next = require('i18next');

  // Create a standalone i18next instance for testing
  const i18nInstance = i18next.createInstance();

  const allKeys = extractDotPathKeys(en);

  beforeAll(async () => {
    await i18nInstance.init({
      resources: {
        en: { translation: en },
        zh: { translation: zh },
      },
      lng: 'en',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
    });
  });

  it('changing to English and calling t(key) returns the English value', async () => {
    await i18nInstance.changeLanguage('en');
    fc.assert(
      fc.property(
        fc.constantFrom(...allKeys),
        (key: string) => {
          const result = i18nInstance.t(key);
          const expected = getNestedValue(en, key);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: Math.max(100, allKeys.length) },
    );
  });

  it('changing to Chinese and calling t(key) returns the Chinese value', async () => {
    await i18nInstance.changeLanguage('zh');
    fc.assert(
      fc.property(
        fc.constantFrom(...allKeys),
        (key: string) => {
          const result = i18nInstance.t(key);
          const expected = getNestedValue(zh, key);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: Math.max(100, allKeys.length) },
    );
  });

  it('round-trip en → zh → en returns the original English value', async () => {
    // Pre-switch to English to capture baseline
    await i18nInstance.changeLanguage('en');
    const enValues = new Map<string, string>();
    for (const key of allKeys) {
      enValues.set(key, i18nInstance.t(key));
    }

    // Switch to Chinese
    await i18nInstance.changeLanguage('zh');
    const zhValues = new Map<string, string>();
    for (const key of allKeys) {
      zhValues.set(key, i18nInstance.t(key));
    }

    // Switch back to English
    await i18nInstance.changeLanguage('en');

    fc.assert(
      fc.property(
        fc.constantFrom(...allKeys),
        (key: string) => {
          // Verify Chinese values matched expected
          expect(zhValues.get(key)).toBe(getNestedValue(zh, key) as string);
          // Verify round-trip returns original English value
          const roundTripValue = i18nInstance.t(key);
          expect(roundTripValue).toBe(enValues.get(key));
        },
      ),
      { numRuns: Math.max(100, allKeys.length) },
    );
  });
});
