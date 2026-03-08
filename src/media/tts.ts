/**
 * Text-to-Speech (TTS) Module
 *
 * Supported engines:
 *   - edge-tts (Microsoft Edge TTS, free, via node-edge-tts)
 *   - openai (OpenAI TTS API, paid)
 *   - gemini (Google Gemini, via multimodal — future)
 */

import { execFile } from 'child_process';
import { readFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export interface TTSOptions {
  /** TTS engine to use */
  engine: 'edge' | 'openai';
  /** Voice name/ID */
  voice?: string;
  /** Speech rate (0.5–2.0) */
  rate?: number;
  /** Output format */
  format?: 'mp3' | 'opus' | 'wav';
}

export interface TTSResult {
  /** Audio data as Buffer */
  audio: Buffer;
  /** MIME type */
  mimeType: string;
  /** Duration in seconds (estimated) */
  durationSec?: number;
}

/**
 * Synthesize text to speech.
 */
export async function synthesize(text: string, options: TTSOptions = { engine: 'edge' }): Promise<TTSResult> {
  if (options.engine === 'openai') {
    return synthesizeOpenAI(text, options);
  }
  return synthesizeEdge(text, options);
}

/**
 * Edge TTS via edge-tts CLI (Python) or node-edge-tts package.
 * Tries node-edge-tts first, falls back to Python edge-tts CLI.
 */
async function synthesizeEdge(text: string, options: TTSOptions): Promise<TTSResult> {
  // Try Python edge-tts CLI first (more reliable)
  try {
    return await synthesizeEdgeCLI(text, options);
  } catch {
    // Fall back to node-edge-tts package
  }

  try {
    return await synthesizeEdgeNode(text, options);
  } catch (err: any) {
    throw new Error(
      `Edge TTS failed. Install either:\n` +
      `  - Python: pip install edge-tts\n` +
      `  - Node: npm install node-edge-tts\n` +
      `Original error: ${err.message}`
    );
  }
}

/**
 * Edge TTS via Python CLI: edge-tts --voice "..." --text "..." --write-media out.mp3
 */
async function synthesizeEdgeCLI(text: string, options: TTSOptions): Promise<TTSResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'tts-'));
  const outFile = join(tmpDir, 'output.mp3');
  const voice = options.voice || 'zh-CN-XiaoxiaoNeural';

  return new Promise<TTSResult>((resolve, reject) => {
    const args = ['--voice', voice, '--text', text, '--write-media', outFile];
    if (options.rate && options.rate !== 1) {
      const pct = Math.round((options.rate - 1) * 100);
      args.push('--rate', `${pct >= 0 ? '+' : ''}${pct}%`);
    }

    execFile('edge-tts', args, { timeout: 30_000 }, async (err) => {
      try {
        if (err) { reject(err); return; }
        const audio = await readFile(outFile);
        await unlink(outFile).catch(() => {});
        resolve({ audio, mimeType: 'audio/mpeg' });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Edge TTS via node-edge-tts package.
 */
async function synthesizeEdgeNode(text: string, options: TTSOptions): Promise<TTSResult> {
  const { EdgeTTS } = require('node-edge-tts');
  const tts = new EdgeTTS();
  const voice = options.voice || 'zh-CN-XiaoxiaoNeural';

  const tmpDir = await mkdtemp(join(tmpdir(), 'tts-'));
  const outFile = join(tmpDir, 'output.mp3');

  await tts.ttsPromise(text, {
    voice,
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    saveSubtitles: false,
    filePath: outFile,
  });

  const audio = await readFile(outFile);
  await unlink(outFile).catch(() => {});
  return { audio, mimeType: 'audio/mpeg' };
}

async function synthesizeOpenAI(text: string, options: TTSOptions): Promise<TTSResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY required for OpenAI TTS');

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: options.voice || 'alloy',
      response_format: options.format || 'mp3',
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI TTS failed: ${response.status} ${response.statusText} ${errText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return { audio: buffer, mimeType: 'audio/mpeg' };
}

/**
 * Get available voices for an engine.
 */
export function getAvailableVoices(engine: 'edge' | 'openai'): string[] {
  if (engine === 'openai') {
    return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  }
  return [
    'zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunjianNeural',
    'en-US-AriaNeural', 'en-US-GuyNeural', 'en-US-JennyNeural',
    'en-GB-SoniaNeural', 'ja-JP-NanamiNeural', 'de-DE-KatjaNeural',
    'fr-FR-DeniseNeural', 'ko-KR-SunHiNeural',
  ];
}
