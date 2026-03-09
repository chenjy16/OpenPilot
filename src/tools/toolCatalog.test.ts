/**
 * Unit tests for toolCatalog — Quant (Stock Analysis) section integration
 *
 * Verifies:
 *   - Quant section exists with 3 tools
 *   - group:quant expansion
 *   - ownerOnly marking
 *   - CATALOG_TO_EXECUTOR mappings
 *   - 'full' profile inclusion
 *   - getToolEntry metadata correctness
 */

import {
  getToolCatalog,
  expandToolGroups,
  getOwnerOnlyTools,
  catalogIdToExecutorName,
  getToolsForProfile,
  getToolEntry,
} from './toolCatalog';

const QUANT_TOOL_IDS = [
  'stock_tech_analysis',
  'stock_sentiment',
  'stock_deliver_alert',
] as const;

describe('toolCatalog — Quant section', () => {
  // 1. Quant section exists with exactly 3 tools
  it('getToolCatalog() contains a Quant section with 3 tools', () => {
    const sections = getToolCatalog();
    const quant = sections.find(s => s.name === 'Quant');
    expect(quant).toBeDefined();
    expect(quant!.tools).toHaveLength(3);

    const ids = quant!.tools.map(t => t.id);
    expect(ids).toEqual(expect.arrayContaining([...QUANT_TOOL_IDS]));
  });

  // 2. expandToolGroups(['group:quant']) returns exactly the 3 quant tool IDs
  it('expandToolGroups(["group:quant"]) returns the 3 quant tool IDs', () => {
    const expanded = expandToolGroups(['group:quant']);
    expect(expanded).toHaveLength(3);
    for (const id of QUANT_TOOL_IDS) {
      expect(expanded).toContain(id);
    }
  });

  // 3. All 3 quant tools are ownerOnly
  it('getOwnerOnlyTools() includes all 3 quant tools', () => {
    const ownerOnly = getOwnerOnlyTools();
    for (const id of QUANT_TOOL_IDS) {
      expect(ownerOnly).toContain(id);
    }
  });

  // 4. CATALOG_TO_EXECUTOR mappings exist for all 3 quant tools
  it('catalogIdToExecutorName maps each quant tool correctly', () => {
    const expected: Record<string, string> = {
      stock_tech_analysis: 'stock_tech_analysis',
      stock_sentiment: 'stock_sentiment',
      stock_deliver_alert: 'stock_deliver_alert',
    };
    for (const [catId, execName] of Object.entries(expected)) {
      expect(catalogIdToExecutorName(catId)).toBe(execName);
    }
  });

  // 5. All 3 quant tools are in the 'full' profile
  it('getToolsForProfile("full") includes all 3 quant tools', () => {
    const fullTools = getToolsForProfile('full');
    for (const id of QUANT_TOOL_IDS) {
      expect(fullTools).toContain(id);
    }
  });

  // 6. getToolEntry returns correct metadata for each quant tool
  describe('getToolEntry returns correct metadata', () => {
    const expectedMeta: Record<string, { emoji: string; verb: string; description: string; section: string }> = {
      stock_tech_analysis: { emoji: '📊', verb: 'Analyzing technicals', description: '股票技术面分析', section: 'Quant' },
      stock_sentiment:     { emoji: '📰', verb: 'Analyzing sentiment', description: '股票消息面分析', section: 'Quant' },
      stock_deliver_alert: { emoji: '🔔', verb: 'Delivering alert',   description: '股票信号投递',   section: 'Quant' },
    };

    for (const [id, meta] of Object.entries(expectedMeta)) {
      it(`${id}`, () => {
        const entry = getToolEntry(id);
        expect(entry).toBeDefined();
        expect(entry!.emoji).toBe(meta.emoji);
        expect(entry!.verb).toBe(meta.verb);
        expect(entry!.description).toBe(meta.description);
        expect(entry!.section).toBe(meta.section);
        expect(entry!.ownerOnly).toBe(true);
      });
    }
  });
});
