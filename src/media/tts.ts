/**
 * Text-to-Speech (TTS) Module
 *
 * OpenPilot equivalent: src/tts/
 * Provides text-to-speech synthesis for voice channels.
 *
 * Supported engines:
 *   - edge-tts (Microsoft Edge TTS, free)
 *   - openai (OpenAI TTS API)
 *
 * This is a foundation stub — full implementation requires
 * node-edge-tts or OpenAI API integration.
 */

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

async function synthesizeEdge(text: string, options: TTSOptions): Promise<TTSResult> {
  try {
    const edgeTts = require('node-edge-tts');
    const tts = new edgeTts.MsEdgeTTS();
    await tts.setMetadata(options.voice || 'en-US-AriaNeural', edgeTts.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const readable = tts.toStream(text);

    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(Buffer.from(chunk));
    }

    return {
      audio: Buffer.concat(chunks),
      mimeType: 'audio/mpeg',
    };
  } catch {
    throw new Error('TTS engine "edge" requires node-edge-tts package. Run: npm install node-edge-tts');
  }
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
    throw new Error(`OpenAI TTS failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    audio: buffer,
    mimeType: 'audio/mpeg',
  };
}

/**
 * Get available voices for an engine.
 */
export function getAvailableVoices(engine: 'edge' | 'openai'): string[] {
  if (engine === 'openai') {
    return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  }
  // Edge TTS has many voices — return common ones
  return [
    'en-US-AriaNeural', 'en-US-GuyNeural', 'en-US-JennyNeural',
    'en-GB-SoniaNeural', 'zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural',
    'ja-JP-NanamiNeural', 'de-DE-KatjaNeural', 'fr-FR-DeniseNeural',
  ];
}
