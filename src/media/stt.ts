/**
 * Speech-to-Text (STT) Module — low-level utilities.
 *
 * Primary STT is handled by VoiceService which uses the user's
 * configured default model. This module provides standalone helpers
 * for direct API calls when needed.
 */

export interface STTOptions {
  engine: 'openai' | 'gemini';
  language?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface STTResult {
  text: string;
  language?: string;
  durationSec?: number;
}

/**
 * Transcribe audio to text using specified engine.
 */
export async function transcribe(audio: Buffer, options: STTOptions): Promise<STTResult> {
  if (options.engine === 'gemini') {
    return transcribeGemini(audio, options);
  }
  return transcribeWhisper(audio, options);
}

async function transcribeWhisper(audio: Buffer, options: STTOptions): Promise<STTResult> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('API key required for Whisper STT');

  const baseUrl = options.baseUrl ?? 'https://api.openai.com';
  const formData = new FormData();
  const blob = new Blob([audio], { type: 'audio/ogg' });
  formData.append('file', blob, 'audio.ogg');
  formData.append('model', options.model || 'whisper-1');
  if (options.language) formData.append('language', options.language);

  const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Whisper STT failed: ${response.status} ${errText.slice(0, 200)}`);
  }

  const result = await response.json() as any;
  return { text: result.text, language: result.language, durationSec: result.duration };
}

async function transcribeGemini(audio: Buffer, options: STTOptions): Promise<STTResult> {
  const apiKey = options.apiKey ?? process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('Google API key required for Gemini STT');

  const model = options.model || 'gemini-2.0-flash';
  const base64Audio = audio.toString('base64');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: `Transcribe the following audio to text. Output ONLY the transcribed text, nothing else.${options.language ? ` The audio is in ${options.language}.` : ''}` },
            { inlineData: { mimeType: 'audio/ogg', data: base64Audio } },
          ],
        }],
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini STT failed: ${response.status} ${errText.slice(0, 200)}`);
  }

  const result = await response.json() as any;
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return { text: text.trim() };
}
