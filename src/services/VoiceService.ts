/**
 * VoiceService — orchestrates STT (speech-to-text) and TTS (text-to-speech).
 *
 * OpenClaw-aligned core design:
 *   1. Explicit Capability Assertion: models declare `input: ['audio']`
 *   2. Single Responsibility: STT uses the session/system default model only
 *   3. Zero-Fallback Routing: if default model lacks audio → block + notify user
 *
 * STT dispatch by provider (only if model.input includes 'audio'):
 *   - google  → Gemini multimodal (inline base64 audio)
 *   - openai  → Whisper API (/v1/audio/transcriptions)
 *
 * TTS is independent: Edge TTS (free) or OpenAI TTS.
 */

import { synthesize, TTSOptions, TTSResult } from '../media/tts';
import type { ModelManager } from '../models/ModelManager';
import type { AppConfig } from '../config/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VoiceConfig {
  ttsAuto?: 'off' | 'always' | 'inbound' | 'tagged';
  ttsProvider?: 'edge' | 'openai';
  ttsVoice?: string;
  sttLanguage?: string;
  maxTtsLength?: number;
}

export interface STTResult {
  text: string;
  language?: string;
  durationSec?: number;
}

const DEFAULT_CONFIG: VoiceConfig = {
  ttsAuto: 'off',
  ttsProvider: 'edge',
  ttsVoice: 'zh-CN-XiaoxiaoNeural',
  sttLanguage: 'zh',
  maxTtsLength: 2000,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class VoiceService {
  private config: VoiceConfig;
  private modelManager?: ModelManager;
  private appConfig?: AppConfig;

  constructor(config?: Partial<VoiceConfig>, modelManager?: ModelManager, appConfig?: AppConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.modelManager = modelManager;
    this.appConfig = appConfig;
  }

  /** Download audio from a URL and return as Buffer. */
  async downloadAudio(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Transcribe audio to text using the default model.
   * Zero-fallback: if the default model doesn't support audio input, throws immediately.
   */
  async transcribe(audio: Buffer): Promise<STTResult> {
    const defaultModel = this.appConfig?.agents?.defaults?.model?.primary;
    if (!defaultModel) {
      throw new Error('🎤 语音转文字失败：未配置默认模型。请在设置中配置默认模型。');
    }

    // ── Explicit Capability Assertion ──
    if (!this.modelManager?.hasAudioInput(defaultModel)) {
      throw new Error(
        `🎤 当前默认模型 "${defaultModel}" 不支持语音输入。\n` +
        `请切换到支持音频的模型（如 Google Gemini 系列），或在"智能体配置"中更改默认模型。`
      );
    }

    // Resolve provider config
    let modelConfig;
    try {
      modelConfig = this.modelManager!.getConfig(defaultModel);
    } catch {
      throw new Error(`🎤 语音转文字失败：模型 "${defaultModel}" 配置异常。`);
    }
    if (!modelConfig) {
      throw new Error(`🎤 语音转文字失败：无法获取模型 "${defaultModel}" 的配置。`);
    }

    const provider = modelConfig.provider;
    const apiKey = modelConfig.apiKey;
    const lang = this.config.sttLanguage ?? 'zh';

    console.log(`[VoiceService] STT via "${defaultModel}" (provider: ${provider})`);

    // ── Dispatch by provider ──
    if (provider === 'google' || provider.startsWith('gemini')) {
      return this.sttGemini(audio, apiKey, modelConfig.model, lang);
    }

    if (provider === 'openai') {
      return this.sttWhisper(audio, apiKey, undefined, lang);
    }

    // Provider has audio capability declared but no STT implementation
    throw new Error(
      `🎤 模型 "${defaultModel}" 声明支持音频输入，但提供商 "${provider}" 的 STT 尚未实现。`
    );
  }

  /** STT via OpenAI Whisper API. */
  private async sttWhisper(audio: Buffer, apiKey: string, baseUrl?: string, language?: string): Promise<STTResult> {
    const url = `${baseUrl ?? 'https://api.openai.com'}/v1/audio/transcriptions`;
    const formData = new FormData();
    const blob = new Blob([audio], { type: 'audio/ogg' });
    formData.append('file', blob, 'audio.ogg');
    formData.append('model', 'whisper-1');
    if (language) formData.append('language', language);

    const response = await fetch(url, {
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

  /** STT via Google Gemini multimodal (audio inline). */
  private async sttGemini(audio: Buffer, apiKey: string, model: string, language?: string): Promise<STTResult> {
    const base64Audio = audio.toString('base64');
    const geminiModel = model.replace('google/', '');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `Transcribe the following audio to text. Output ONLY the transcribed text, nothing else.${language ? ` The audio language is ${language}.` : ''}` },
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

  /** Synthesize text to speech. Returns null if text is too long. */
  async synthesize(text: string): Promise<TTSResult | null> {
    if (!text || text.length > (this.config.maxTtsLength ?? 2000)) return null;
    return synthesize(text, {
      engine: this.config.ttsProvider ?? 'edge',
      voice: this.config.ttsVoice,
      format: 'mp3',
    });
  }

  /** Should we auto-reply with voice for this message? */
  shouldAutoTTS(isVoiceInbound: boolean): boolean {
    switch (this.config.ttsAuto) {
      case 'always': return true;
      case 'inbound': return isVoiceInbound;
      default: return false;
    }
  }

  getConfig(): VoiceConfig {
    return { ...this.config };
  }
}
