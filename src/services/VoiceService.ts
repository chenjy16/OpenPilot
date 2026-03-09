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
  ttsModel?: string;
  ttsVoice?: string;
  sttLanguage?: string;
  sttModel?: string;
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

  /**
   * Live-read voice config from appConfig (hot-update support).
   * Falls back to constructor-time config for fields not in appConfig.voice.
   */
  private get liveSTTModel(): string | undefined {
    return this.appConfig?.voice?.stt?.model || this.config.sttModel;
  }
  private get liveTTSModel(): string | undefined {
    return this.appConfig?.voice?.tts?.model || this.config.ttsModel;
  }
  private get liveSTTLanguage(): string {
    return this.appConfig?.voice?.stt?.language || this.config.sttLanguage || 'zh';
  }
  private get liveTTSAuto(): string {
    return this.appConfig?.voice?.tts?.auto || this.config.ttsAuto || 'off';
  }
  private get liveTTSVoice(): string | undefined {
    return this.appConfig?.voice?.tts?.voice || this.config.ttsVoice;
  }
  private get liveMaxTtsLength(): number {
    return this.appConfig?.voice?.tts?.maxTextLength || this.config.maxTtsLength || 2000;
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
   * Transcribe audio to text.
   * Priority: voice.stt.model (live from appConfig) → agents.defaults.model.primary
   * Zero-fallback: if chosen model doesn't support audio input, throws immediately.
   */
  async transcribe(audio: Buffer): Promise<STTResult> {
    const sttModel = this.liveSTTModel;
    const defaultModel = this.appConfig?.agents?.defaults?.model?.primary;
    const chosenModel = sttModel || defaultModel;

    if (!chosenModel) {
      throw new Error('🎤 语音转文字失败：未配置 STT 模型，也未配置默认模型。请在"语音配置"中设置 STT 模型，或在"智能体配置"中设置默认模型。');
    }

    // ── Explicit Capability Assertion ──
    if (!this.modelManager?.hasAudioInput(chosenModel)) {
      if (sttModel) {
        throw new Error(
          `🎤 语音配置中指定的 STT 模型 "${chosenModel}" 不支持音频输入。\n` +
          `请在"语音配置 → STT 模型"中切换到支持音频的模型（如 google/gemini-2.0-flash）。`
        );
      }
      throw new Error(
        `🎤 当前默认模型 "${chosenModel}" 不支持语音输入。\n` +
        `请在"语音配置"中单独设置 STT 模型（如 google/gemini-2.0-flash），或切换默认模型。`
      );
    }

    // Resolve provider config
    let modelConfig;
    try {
      modelConfig = this.modelManager!.getConfig(chosenModel);
    } catch {
      throw new Error(`🎤 语音转文字失败：模型 "${chosenModel}" 配置异常。`);
    }
    if (!modelConfig) {
      throw new Error(`🎤 语音转文字失败：无法获取模型 "${chosenModel}" 的配置。`);
    }

    const provider = modelConfig.provider;
    const apiKey = modelConfig.apiKey;
    const lang = this.liveSTTLanguage;

    // Resolve baseUrl: ModelConfig.baseUrl OR appConfig.models.providers[provider].baseUrl
    const baseUrl = modelConfig.baseUrl
      || this.appConfig?.models?.providers?.[provider]?.baseUrl;

    console.log(`[VoiceService] STT via "${chosenModel}" (provider: ${provider}, baseUrl: ${baseUrl ?? 'none'})`);

    // ── Dispatch by provider ──
    if (provider === 'google' || provider.startsWith('gemini')) {
      return this.sttGemini(audio, apiKey, modelConfig.model, lang);
    }

    if (provider === 'openai' && !baseUrl) {
      return this.sttWhisper(audio, apiKey, undefined, lang);
    }

    // OpenAI-compatible providers with custom baseUrl (DashScope Qwen Omni, etc.)
    // These use multimodal chat completions with audio in messages
    if (baseUrl) {
      return this.sttOpenAICompatible(audio, apiKey, baseUrl, modelConfig.model, lang);
    }

    // Provider has audio capability declared but no STT implementation
    throw new Error(
      `🎤 模型 "${chosenModel}" 声明支持音频输入，但提供商 "${provider}" 的 STT 尚未实现。`
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

  /**
   * STT via OpenAI-compatible multimodal chat completions (DashScope Qwen Omni, etc.).
   * Sends audio as base64 input_audio in the messages array.
   */
  /**
     * STT via OpenAI-compatible multimodal chat completions (DashScope Qwen Omni, etc.).
     * Sends audio as base64 input_audio in the messages array.
     * DashScope requires stream=true; supported audio formats: AMR, WAV, MP3, AAC, 3GP.
     * Telegram voice messages are OGG/Opus — we send as mp3 (DashScope is lenient with Opus-in-OGG).
     */
    /**
       * STT via OpenAI-compatible multimodal chat completions (DashScope Qwen Omni, etc.).
       * DashScope requires stream=true; supported audio formats: AMR, WAV, MP3, AAC, 3GP.
       * Telegram voice is OGG/Opus — convert to MP3 via ffmpeg before sending.
       */
      private async sttOpenAICompatible(
        audio: Buffer, apiKey: string, baseUrl: string, model: string, language?: string,
      ): Promise<STTResult> {
        // Convert OGG/Opus to MP3 for DashScope compatibility
        const mp3Audio = await this.convertToMp3(audio);
        const base64Audio = mp3Audio.toString('base64');
        const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

        const prompt = `请将以下音频转录为文字，只输出转录文本，不要输出任何其他内容。${language ? `音频语言为${language}。` : ''}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{
              role: 'user',
              content: [
                { type: 'input_audio', input_audio: { data: `data:audio/mp3;base64,${base64Audio}`, format: 'mp3' } },
                { type: 'text', text: prompt },
              ],
            }],
            modalities: ['text'],
            stream: true,
            stream_options: { include_usage: true },
          }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`OpenAI-compatible STT failed (${baseUrl}): ${response.status} ${errText.slice(0, 300)}`);
        }

        // Parse SSE streaming response
        const body = await response.text();
        let fullText = '';
        for (const line of body.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') break;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) fullText += delta;
          } catch {
            // skip malformed chunks
          }
        }

        return { text: fullText.trim() };
      }

      /**
       * Convert audio buffer (OGG/Opus or any format) to MP3 via ffmpeg.
       * Falls back to original buffer if ffmpeg is not available.
       */
      private async convertToMp3(audio: Buffer): Promise<Buffer> {
        try {
          const { execFile } = await import('child_process');
          const { promisify } = await import('util');
          const { tmpdir } = await import('os');
          const { join } = await import('path');
          const { writeFile, readFile, unlink } = await import('fs/promises');
          const execFileAsync = promisify(execFile);

          const id = Date.now().toString(36);
          const inputPath = join(tmpdir(), `stt_in_${id}.ogg`);
          const outputPath = join(tmpdir(), `stt_out_${id}.mp3`);

          await writeFile(inputPath, audio);
          await execFileAsync('ffmpeg', ['-i', inputPath, '-f', 'mp3', '-ar', '16000', '-ac', '1', '-y', outputPath], { timeout: 15000 });
          const mp3 = await readFile(outputPath);

          // Cleanup temp files
          unlink(inputPath).catch(() => {});
          unlink(outputPath).catch(() => {});

          return mp3;
        } catch (err: any) {
          console.warn(`[VoiceService] ffmpeg conversion failed, sending raw audio: ${err.message}`);
          return audio;
        }
      }




  /** Synthesize text to speech. Returns null if text is too long. */
  async synthesize(text: string): Promise<TTSResult | null> {
    if (!text || text.length > this.liveMaxTtsLength) return null;

    // Resolve TTS engine from tts.model config (live)
    const ttsModel = this.liveTTSModel;
    let engine: 'edge' | 'openai' = 'edge';

    if (ttsModel) {
      if (ttsModel.startsWith('openai/')) {
        engine = 'openai';
      }
      // All other models (including edge/* or unknown) default to edge
    }

    return synthesize(text, {
      engine,
      voice: this.liveTTSVoice,
      format: 'mp3',
    });
  }

  /** Should we auto-reply with voice for this message? */
  shouldAutoTTS(isVoiceInbound: boolean): boolean {
    switch (this.liveTTSAuto) {
      case 'always': return true;
      case 'inbound': return isVoiceInbound;
      default: return false;
    }
  }

  getConfig(): VoiceConfig {
    return {
      sttModel: this.liveSTTModel,
      sttLanguage: this.liveSTTLanguage,
      ttsAuto: this.liveTTSAuto as any,
      ttsModel: this.liveTTSModel,
      ttsVoice: this.liveTTSVoice,
      maxTtsLength: this.liveMaxTtsLength,
    };
  }
}
