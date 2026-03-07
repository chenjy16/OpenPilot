/**
 * PairingStore — manages pairing requests and AllowFrom whitelist
 *
 * Storage layout:
 *   ~/.openpilot/credentials/{channel}/{accountId}/pairing.json
 *   ~/.openpilot/credentials/{channel}/{accountId}/allow-from.json
 *
 * Design doc: "Channel 消息处理与设备管理.md" §组件6
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PairingRequest {
  id: string;           // sender ID
  code: string;         // 6-digit pairing code
  createdAt: string;    // ISO timestamp
  lastSeenAt?: string;  // last activity
  meta?: Record<string, string>;
}

export interface PairingResult {
  code: string;
  created: boolean;
}

export interface ApproveResult {
  approved: boolean;
  id?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREDENTIALS_ROOT = path.join(os.homedir(), '.openpilot', 'credentials');
const PAIRING_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function credentialsDir(channel: string, accountId: string): string {
  return path.join(CREDENTIALS_ROOT, channel, accountId);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generatePairingCode(): string {
  // 6-digit random code
  return String(crypto.randomInt(100_000, 999_999));
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: any): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Pairing Requests
// ---------------------------------------------------------------------------

/**
 * Upsert a pairing request for a sender.
 * If the sender already has an active (non-expired) request, returns it.
 * Otherwise creates a new one with a fresh 6-digit code.
 */
export function upsertPairingRequest(params: {
  channel: string;
  id: string;
  accountId?: string;
  meta?: Record<string, string>;
}): PairingResult {
  const { channel, id, meta } = params;
  const accountId = params.accountId ?? 'default';
  const dir = credentialsDir(channel, accountId);
  const filePath = path.join(dir, 'pairing.json');

  const requests: PairingRequest[] = readJsonFile(filePath, []);

  // Prune expired
  const now = Date.now();
  const active = requests.filter(r => now - new Date(r.createdAt).getTime() < PAIRING_EXPIRY_MS);

  // Check existing
  const existing = active.find(r => r.id === id);
  if (existing) {
    existing.lastSeenAt = new Date().toISOString();
    writeJsonFile(filePath, active);
    return { code: existing.code, created: false };
  }

  // Generate unique code
  const existingCodes = new Set(active.map(r => r.code));
  let code: string;
  do { code = generatePairingCode(); } while (existingCodes.has(code));

  const request: PairingRequest = {
    id,
    code,
    createdAt: new Date().toISOString(),
    meta,
  };
  active.push(request);
  writeJsonFile(filePath, active);

  return { code, created: true };
}

/**
 * Approve a pairing code — moves the sender to AllowFrom and removes the request.
 */
export function approveChannelPairingCode(params: {
  channel: string;
  code: string;
  accountId?: string;
}): ApproveResult {
  const { channel, code } = params;
  const accountId = params.accountId ?? 'default';
  const dir = credentialsDir(channel, accountId);
  const filePath = path.join(dir, 'pairing.json');

  const requests: PairingRequest[] = readJsonFile(filePath, []);
  const now = Date.now();
  const active = requests.filter(r => now - new Date(r.createdAt).getTime() < PAIRING_EXPIRY_MS);

  const match = active.find(r => r.code === code);
  if (!match) {
    return { approved: false };
  }

  // Add to AllowFrom
  addAllowFromEntry({ channel, entry: match.id, accountId });

  // Remove the approved request
  const remaining = active.filter(r => r.code !== code);
  writeJsonFile(filePath, remaining);

  return { approved: true, id: match.id };
}

/**
 * List all active (non-expired) pairing requests for a channel/account.
 */
export function listPairingRequests(params: {
  channel: string;
  accountId?: string;
}): PairingRequest[] {
  const { channel } = params;
  const accountId = params.accountId ?? 'default';
  const dir = credentialsDir(channel, accountId);
  const filePath = path.join(dir, 'pairing.json');

  const requests: PairingRequest[] = readJsonFile(filePath, []);
  const now = Date.now();
  return requests.filter(r => now - new Date(r.createdAt).getTime() < PAIRING_EXPIRY_MS);
}

// ---------------------------------------------------------------------------
// AllowFrom Store
// ---------------------------------------------------------------------------

/**
 * Read the AllowFrom whitelist for a channel/account.
 */
export function readAllowFrom(params: {
  channel: string;
  accountId?: string;
}): string[] {
  const { channel } = params;
  const accountId = params.accountId ?? 'default';
  const filePath = path.join(credentialsDir(channel, accountId), 'allow-from.json');
  return readJsonFile(filePath, []);
}

/**
 * Add an entry to the AllowFrom whitelist.
 */
export function addAllowFromEntry(params: {
  channel: string;
  entry: string;
  accountId?: string;
}): void {
  const { channel, entry } = params;
  const accountId = params.accountId ?? 'default';
  const filePath = path.join(credentialsDir(channel, accountId), 'allow-from.json');

  const entries: string[] = readJsonFile(filePath, []);
  const normalized = String(entry).trim();
  if (!normalized || entries.includes(normalized)) return;

  entries.push(normalized);
  writeJsonFile(filePath, entries);
}

/**
 * Remove an entry from the AllowFrom whitelist.
 */
export function removeAllowFromEntry(params: {
  channel: string;
  entry: string;
  accountId?: string;
}): boolean {
  const { channel, entry } = params;
  const accountId = params.accountId ?? 'default';
  const filePath = path.join(credentialsDir(channel, accountId), 'allow-from.json');

  const entries: string[] = readJsonFile(filePath, []);
  const normalized = String(entry).trim();
  const idx = entries.indexOf(normalized);
  if (idx === -1) return false;

  entries.splice(idx, 1);
  writeJsonFile(filePath, entries);
  return true;
}

// ---------------------------------------------------------------------------
// AllowFrom merge logic (design doc §DM安全策略)
// ---------------------------------------------------------------------------

/**
 * Merge AllowFrom from config + pairing store based on DM policy.
 * - allowlist policy: only config entries
 * - pairing policy: config + store entries
 * - open policy: not used (all allowed)
 */
export function mergeDmAllowFromSources(params: {
  allowFrom?: (string | number)[];
  storeAllowFrom?: (string | number)[];
  dmPolicy?: string;
}): { entries: string[]; hasWildcard: boolean; hasEntries: boolean } {
  const storeEntries = params.dmPolicy === 'allowlist' ? [] : (params.storeAllowFrom ?? []);
  const merged = [...(params.allowFrom ?? []), ...storeEntries]
    .map(v => String(v).trim())
    .filter(Boolean);

  const hasWildcard = merged.includes('*');
  return { entries: merged, hasWildcard, hasEntries: merged.length > 0 };
}

/**
 * Check if a sender ID is allowed by the AllowFrom list.
 */
export function isSenderIdAllowed(
  allow: { entries: string[]; hasWildcard: boolean; hasEntries: boolean },
  senderId: string | undefined,
  allowWhenEmpty: boolean,
): boolean {
  if (!allow.hasEntries) return allowWhenEmpty;
  if (allow.hasWildcard) return true;
  if (!senderId) return false;
  return allow.entries.includes(senderId);
}
