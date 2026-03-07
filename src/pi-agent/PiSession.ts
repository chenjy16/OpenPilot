/**
 * PiSession — lightweight conversation state container.
 *
 * Mirrors @mariozechner/pi-agent-core PiSession.
 * Maintains an ordered transcript of messages that the PiAgent loop
 * reads from and appends to.
 */

import { TranscriptMessage } from './types';

export class PiSession {
  readonly sessionId: string;
  private transcript: TranscriptMessage[];

  constructor(opts: { sessionId: string; initialTranscript?: TranscriptMessage[] }) {
    this.sessionId = opts.sessionId;
    this.transcript = opts.initialTranscript ? [...opts.initialTranscript] : [];
  }

  /** Get the full transcript (read-only copy). */
  getTranscript(): TranscriptMessage[] {
    return [...this.transcript];
  }

  /** Append a message to the transcript. */
  append(message: TranscriptMessage): void {
    this.transcript.push(message);
  }

  /** Replace the transcript (e.g. after compaction). */
  replaceTranscript(messages: TranscriptMessage[]): void {
    this.transcript = [...messages];
  }

  /** Number of messages in the transcript. */
  get length(): number {
    return this.transcript.length;
  }
}
