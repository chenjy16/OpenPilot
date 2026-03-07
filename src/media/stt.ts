/**
 * Speech-to-Text (STT) Module
 *
 * OpenPilot equivalent: media pipeline audio transcription.
 * Provides audio transcription using OpenAI Whisper API.
 */

export interface STTOptions {
  /** STT engine */
  engine: 'openai';
  /** Language hint (ISO 639-1) */
  language?: string;
  /** Model to use */
  model?: string;
}

export interface STTResult {
  /** Transcribed text */
  text: string;
  /** Detected language */
  language?: string;
  /** Duration of audio in seconds */
  durationSec?: number;
}

/**
 * Transcribe audio to text.
 */
export async function transcribe(audio: Buffer, options: STTOptions = { engine: 'openai' }): Promise<STTResult> {
  if (options.engine === 'openai') {
    return transcribeOpenAI(audio, options);
  }
  throw new Error(`Unsupported STT engine: ${options.engine}`);
}

async function transcribeOpenAI(audio: Buffer, options: STTOptions): Promise<STTResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY required for OpenAI STT');

  const FormData = (globalThis as any).FormData ?? (await import('node:buffer')).File;

  // Use native fetch with FormData
  const formData = new FormData();
  const blob = new Blob([audio], { type: 'audio/mpeg' });
  formData.append('file', blob, 'audio.mp3');
  formData.append('model', options.model || 'whisper-1');
  if (options.language) formData.append('language', options.language);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`OpenAI STT failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as any;
  return {
    text: result.text,
    language: result.language,
    durationSec: result.duration,
  };
}
