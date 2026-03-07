/**
 * PairingStore unit tests
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Create temp dir before mocking
const TEST_ROOT = path.join(os.tmpdir(), `pairing-test-${Date.now()}`);

// Mock os.homedir to redirect credentials storage to temp dir
jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return {
    ...actual,
    homedir: () => require('path').join(actual.tmpdir(), `pairing-test-${process.env.__PAIRING_TEST_TS__}`),
  };
});

// Set a stable identifier for this test run
process.env.__PAIRING_TEST_TS__ = String(Date.now());
const effectiveRoot = path.join(os.tmpdir(), `pairing-test-${process.env.__PAIRING_TEST_TS__}`);

import {
  upsertPairingRequest,
  approveChannelPairingCode,
  listPairingRequests,
  readAllowFrom,
  addAllowFromEntry,
  removeAllowFromEntry,
  mergeDmAllowFromSources,
  isSenderIdAllowed,
} from './PairingStore';

afterAll(() => {
  try { fs.rmSync(effectiveRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('PairingStore', () => {
  const channel = 'telegram';
  const accountId = 'test-account';

  describe('upsertPairingRequest', () => {
    it('creates a new pairing request with 6-digit code', () => {
      const result = upsertPairingRequest({ channel, id: 'user1', accountId });
      expect(result.created).toBe(true);
      expect(result.code).toMatch(/^\d{6}$/);
    });

    it('returns existing request on duplicate', () => {
      const first = upsertPairingRequest({ channel, id: 'user2', accountId });
      const second = upsertPairingRequest({ channel, id: 'user2', accountId });
      expect(second.created).toBe(false);
      expect(second.code).toBe(first.code);
    });

    it('generates unique codes for different users', () => {
      const r1 = upsertPairingRequest({ channel, id: 'user-a', accountId });
      const r2 = upsertPairingRequest({ channel, id: 'user-b', accountId });
      expect(r1.code).not.toBe(r2.code);
    });

    it('stores metadata', () => {
      upsertPairingRequest({ channel, id: 'user-meta', accountId, meta: { name: 'Test' } });
      const requests = listPairingRequests({ channel, accountId });
      const found = requests.find(r => r.id === 'user-meta');
      expect(found?.meta?.name).toBe('Test');
    });
  });

  describe('listPairingRequests', () => {
    it('returns active requests', () => {
      const requests = listPairingRequests({ channel, accountId });
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0]).toHaveProperty('id');
      expect(requests[0]).toHaveProperty('code');
      expect(requests[0]).toHaveProperty('createdAt');
    });
  });

  describe('approveChannelPairingCode', () => {
    it('approves a valid code and adds to AllowFrom', () => {
      const { code } = upsertPairingRequest({ channel, id: 'approve-user', accountId });
      const result = approveChannelPairingCode({ channel, code, accountId });
      expect(result.approved).toBe(true);
      expect(result.id).toBe('approve-user');

      // Verify added to AllowFrom
      const allowList = readAllowFrom({ channel, accountId });
      expect(allowList).toContain('approve-user');
    });

    it('rejects invalid code', () => {
      const result = approveChannelPairingCode({ channel, code: '000000', accountId });
      expect(result.approved).toBe(false);
    });

    it('removes request after approval', () => {
      const { code } = upsertPairingRequest({ channel, id: 'remove-after', accountId });
      approveChannelPairingCode({ channel, code, accountId });
      const requests = listPairingRequests({ channel, accountId });
      expect(requests.find(r => r.id === 'remove-after')).toBeUndefined();
    });
  });

  describe('AllowFrom CRUD', () => {
    const testChannel = 'discord';
    const testAccount = 'allow-test';

    it('starts empty', () => {
      const entries = readAllowFrom({ channel: testChannel, accountId: testAccount });
      expect(entries).toEqual([]);
    });

    it('adds entries', () => {
      addAllowFromEntry({ channel: testChannel, entry: 'user-x', accountId: testAccount });
      addAllowFromEntry({ channel: testChannel, entry: 'user-y', accountId: testAccount });
      const entries = readAllowFrom({ channel: testChannel, accountId: testAccount });
      expect(entries).toEqual(['user-x', 'user-y']);
    });

    it('deduplicates entries', () => {
      addAllowFromEntry({ channel: testChannel, entry: 'user-x', accountId: testAccount });
      const entries = readAllowFrom({ channel: testChannel, accountId: testAccount });
      expect(entries.filter(e => e === 'user-x').length).toBe(1);
    });

    it('removes entries', () => {
      const removed = removeAllowFromEntry({ channel: testChannel, entry: 'user-x', accountId: testAccount });
      expect(removed).toBe(true);
      const entries = readAllowFrom({ channel: testChannel, accountId: testAccount });
      expect(entries).not.toContain('user-x');
    });

    it('returns false for non-existent removal', () => {
      const removed = removeAllowFromEntry({ channel: testChannel, entry: 'nonexistent', accountId: testAccount });
      expect(removed).toBe(false);
    });
  });
});

describe('mergeDmAllowFromSources', () => {
  it('merges config + store for pairing policy', () => {
    const result = mergeDmAllowFromSources({
      allowFrom: ['user1'],
      storeAllowFrom: ['user2'],
      dmPolicy: 'pairing',
    });
    expect(result.entries).toEqual(['user1', 'user2']);
    expect(result.hasEntries).toBe(true);
    expect(result.hasWildcard).toBe(false);
  });

  it('only uses config for allowlist policy', () => {
    const result = mergeDmAllowFromSources({
      allowFrom: ['user1'],
      storeAllowFrom: ['user2'],
      dmPolicy: 'allowlist',
    });
    expect(result.entries).toEqual(['user1']);
  });

  it('detects wildcard', () => {
    const result = mergeDmAllowFromSources({
      allowFrom: ['*'],
      dmPolicy: 'pairing',
    });
    expect(result.hasWildcard).toBe(true);
  });

  it('handles empty sources', () => {
    const result = mergeDmAllowFromSources({ dmPolicy: 'pairing' });
    expect(result.entries).toEqual([]);
    expect(result.hasEntries).toBe(false);
  });

  it('converts numbers to strings', () => {
    const result = mergeDmAllowFromSources({
      allowFrom: [12345 as any],
      dmPolicy: 'pairing',
    });
    expect(result.entries).toEqual(['12345']);
  });
});

describe('isSenderIdAllowed', () => {
  it('returns allowWhenEmpty when no entries', () => {
    const allow = { entries: [], hasWildcard: false, hasEntries: false };
    expect(isSenderIdAllowed(allow, 'user1', true)).toBe(true);
    expect(isSenderIdAllowed(allow, 'user1', false)).toBe(false);
  });

  it('returns true for wildcard', () => {
    const allow = { entries: ['*'], hasWildcard: true, hasEntries: true };
    expect(isSenderIdAllowed(allow, 'anyone', false)).toBe(true);
  });

  it('returns false when no senderId', () => {
    const allow = { entries: ['user1'], hasWildcard: false, hasEntries: true };
    expect(isSenderIdAllowed(allow, undefined, false)).toBe(false);
  });

  it('checks entries list', () => {
    const allow = { entries: ['user1', 'user2'], hasWildcard: false, hasEntries: true };
    expect(isSenderIdAllowed(allow, 'user1', false)).toBe(true);
    expect(isSenderIdAllowed(allow, 'user3', false)).toBe(false);
  });
});
