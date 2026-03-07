/**
 * Tool Policy Engine
 *
 * OpenPilot Tool Pipeline alignment: configurable allowlist/denylist
 * for tool execution. Integrates with ToolExecutor's before_tool_call
 * hook system to enforce access control.
 *
 * Policy resolution order:
 *   1. If denylist contains the tool → BLOCK
 *   2. If allowlist is defined and non-empty → tool must be in allowlist
 *   3. Otherwise → ALLOW
 *
 * Supports per-session policy overrides (e.g. main session = full access,
 * sub-session = restricted).
 */

import { ToolCallContext, BeforeToolCallHook } from './ToolExecutor';

export interface ToolPolicy {
  /** Tools that are always blocked. Takes precedence over allowlist. */
  denylist: string[];
  /** If non-empty, only these tools are allowed. Empty = allow all. */
  allowlist: string[];
  /** Tools that require human approval (triggers hook to request confirmation). */
  requireApproval: string[];
}

const DEFAULT_POLICY: ToolPolicy = {
  denylist: [],
  allowlist: [],
  requireApproval: [],
};

export class PolicyEngine {
  private globalPolicy: ToolPolicy;
  private sessionPolicies: Map<string, ToolPolicy> = new Map();

  constructor(globalPolicy?: Partial<ToolPolicy>) {
    this.globalPolicy = { ...DEFAULT_POLICY, ...globalPolicy };
  }

  /** Set a per-session policy override. */
  setSessionPolicy(sessionId: string, policy: Partial<ToolPolicy>): void {
    this.sessionPolicies.set(sessionId, {
      ...this.globalPolicy,
      ...policy,
    });
  }

  /** Remove a per-session policy override. */
  clearSessionPolicy(sessionId: string): void {
    this.sessionPolicies.delete(sessionId);
  }

  /** Update the global policy at runtime (e.g. from config changes). */
  updateGlobalPolicy(updates: Partial<ToolPolicy>): void {
    if (updates.denylist !== undefined) this.globalPolicy.denylist = updates.denylist;
    if (updates.allowlist !== undefined) this.globalPolicy.allowlist = updates.allowlist;
    if (updates.requireApproval !== undefined) this.globalPolicy.requireApproval = updates.requireApproval;
  }

  /** Get the current global policy. */
  getGlobalPolicy(): ToolPolicy {
    return this.globalPolicy;
  }

  /** Get the effective policy for a session (session override > global). */
  getEffectivePolicy(sessionId?: string): ToolPolicy {
    if (sessionId && this.sessionPolicies.has(sessionId)) {
      return this.sessionPolicies.get(sessionId)!;
    }
    return this.globalPolicy;
  }

  /**
   * Check if a tool is allowed by the policy.
   * @returns 'allow' | 'deny' | 'require_approval'
   */
  check(toolName: string, sessionId?: string): 'allow' | 'deny' | 'require_approval' {
    const policy = this.getEffectivePolicy(sessionId);

    // Denylist takes absolute precedence
    if (policy.denylist.includes(toolName)) {
      return 'deny';
    }

    // If allowlist is defined and non-empty, tool must be in it
    if (policy.allowlist.length > 0 && !policy.allowlist.includes(toolName)) {
      return 'deny';
    }

    // Check if approval is required
    if (policy.requireApproval.includes(toolName)) {
      return 'require_approval';
    }

    return 'allow';
  }

  /**
   * Create a BeforeToolCallHook that enforces this policy engine.
   * Wire this into ToolExecutor.onBeforeToolCall().
   *
   * When a tool requires approval, the hook returns false (blocked).
   * The caller should implement a human-in-the-loop flow to handle
   * 'require_approval' cases externally.
   *
   * @param onRequireApproval - Optional async callback for approval flow.
   *   If provided and returns true, the tool is allowed to proceed.
   */
  createHook(
    onRequireApproval?: (ctx: ToolCallContext) => Promise<boolean>,
  ): BeforeToolCallHook {
    return async (ctx: ToolCallContext): Promise<boolean | ToolCallContext> => {
      const decision = this.check(ctx.toolName, ctx.sessionId);

      if (decision === 'deny') {
        return false;
      }

      if (decision === 'require_approval') {
        if (onRequireApproval) {
          const approved = await onRequireApproval(ctx);
          return approved ? ctx : false;
        }
        // No approval handler → block by default (safe)
        return false;
      }

      return ctx; // allow — pass through unchanged
    };
  }
}
