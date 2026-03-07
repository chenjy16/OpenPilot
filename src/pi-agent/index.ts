/**
 * Pi Agent Core — barrel export with dual-mode switch.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  MODE A (current): Local shim implementation                   │
 * │  MODE B (future):  Real @mariozechner/pi-agent-core +          │
 * │                    @mariozechner/pi-coding-agent npm packages   │
 * │                                                                │
 * │  To switch to the real packages:                               │
 * │  1. npm install @mariozechner/pi-agent-core                    │
 * │     @mariozechner/pi-coding-agent @mariozechner/pi-tools zod   │
 * │  2. Comment out MODE A exports below                           │
 * │  3. Uncomment MODE B exports below                             │
 * │  4. Run tests: npm test (all tests should stay green)          │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Real OpenPilot imports observed in source:
 *   import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
 *   import type { AgentSession, ToolDefinition } from "@mariozechner/pi-coding-agent";
 */

// ===========================================================================
// MODE A: Local shim (active)
// ===========================================================================
export { PiAgent } from './PiAgent';
export { PiSession } from './PiSession';
export * from './types';

// ===========================================================================
// MODE B: Real packages (uncomment when available)
// ===========================================================================
// // Core agent runtime
// export { PiAgent } from '@mariozechner/pi-agent-core';
// export type {
//   AgentTool as PiTool,
//   AgentToolResult as PiToolResultContent,
//   AgentToolUpdateCallback as PiToolUpdateCallback,
// } from '@mariozechner/pi-agent-core';
//
// // Coding agent (session, tool definitions)
// export type {
//   AgentSession,
//   ToolDefinition,
// } from '@mariozechner/pi-coding-agent';
//
// // Re-export our PiSession as a wrapper around AgentSession
// export { PiSession } from './PiSession';
//
// // Pre-built tools from @mariozechner/pi-tools
// export { BashTool, ReadFileTool, WriteFileTool, EditFileTool } from '@mariozechner/pi-tools';

// ===========================================================================
// Always export our adapters (bridge layer between app and Pi Agent)
// ===========================================================================
export * from './adapters';
export * from './tokenEstimator';
