/**
 * Voice Tools — STT and TTS as proper Tool registrations
 *
 * OpenClaw design: every voice capability is a single-responsibility Tool.
 * LLM can explicitly call these tools for voice interactions.
 *
 * Tools:
 *   - stt_tool: Speech-to-Text (audio file/buffer → text)
 *   - tts_tool: Text-to-Speech (text → audio file)
 *
 * Fail-Fast: missing provider/config → immediate clear error.
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';
import type { VoiceService } from '../services/VoiceService';
import { synthesize, getAvailableVoices } from '../media/tts';

let _voiceService: VoiceService | null = null;

/** Inject VoiceService reference (called from index.ts). */
export function setVoiceServiceRef(vs: VoiceService): void {
  _voiceService = vs;
}

async function getVoiceOutputDir(): Promise<string> {
  const dir = join(homedir(), '.openpilot', 'generated', 'voice');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// STT Tool
// ---------------------------------------------------------------------------

export const sttTool: Tool = {
  name: 'stt_tool',
  description:
    '语音转文字（Speech-to-Text）。将音频 URL 或 base64 转为文本。' +
    '使用系统默认模型进行转录。如果默认模型不支持音频输入，会返回明确错误。',
  parameters: {
    type: 'object',
    properties: {
      audio_url: {
        type: 'string',
        description: '音频文件 URL（与 audio_base64 二选一）',
      },
      audio_base64: {
        type: 'string',
        description: '音频 base64 编码数据（与 audio_url 二选一）',
      },
      language: {
        type: 'string',
        description: '音频语言：zh（中文）、en（英文）等，默认 zh',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<any> => {
    if (!_voiceService) {
      throw new Error('🎤 语音服务未初始化。请检查系统配置。');
    }

    let audioBuffer: Buffer;

    if (params.audio_base64) {
      audioBuffer = Buffer.from(params.audio_base64 as string, 'base64');
    } else if (params.audio_url) {
      audioBuffer = await _voiceService.downloadAudio(params.audio_url as string);
    } else {
      throw new Error('🎤 必须提供 audio_url 或 audio_base64 参数。');
    }

    const result = await _voiceService.transcribe(audioBuffer);

    return {
      success: true,
      text: result.text,
      language: result.language ?? params.language ?? 'zh',
      durationSec: result.durationSec,
    };
  },
};

// ---------------------------------------------------------------------------
// TTS Tool
// ---------------------------------------------------------------------------

export const ttsTool: Tool = {
  name: 'tts_tool',
  description:
    '文字转语音（Text-to-Speech）。将文本合成为语音文件并返回。' +
    '支持 Edge TTS（免费）和 OpenAI TTS。生成的音频文件会自动发送给用户。',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '要合成的文本内容',
      },
      voice: {
        type: 'string',
        description: '语音名称，如 zh-CN-XiaoxiaoNeural、zh-CN-YunxiNeural、alloy 等',
      },
      provider: {
        type: 'string',
        description: 'TTS 引擎：edge（免费）或 openai（付费），默认 edge',
      },
    },
    required: ['text'],
  },
  execute: async (params: Record<string, unknown>): Promise<any> => {
    const text = params.text as string;
    if (!text || text.length === 0) {
      throw new Error('🔊 文本内容不能为空。');
    }

    if (text.length > 5000) {
      throw new Error('🔊 文本过长（最大 5000 字符），请缩短内容。');
    }

    const engine = (params.provider as string) === 'openai' ? 'openai' : 'edge';
    const voice = (params.voice as string) ?? (engine === 'edge' ? 'zh-CN-XiaoxiaoNeural' : 'alloy');

    const result = await synthesize(text, { engine, voice, format: 'mp3' });

    // Save to file
    const outputDir = await getVoiceOutputDir();
    const filename = `tts_${Date.now()}.mp3`;
    const filePath = join(outputDir, filename);
    await writeFile(filePath, result.audio);

    const sizeKB = Math.round(result.audio.length / 1024);

    return {
      success: true,
      filePath,
      filename,
      sizeKB,
      mimeType: result.mimeType,
      durationSec: result.durationSec,
      voice,
      provider: engine,
      note: `语音已生成 (${sizeKB} KB)，将自动发送给用户。`,
    };
  },
};

// ---------------------------------------------------------------------------
// Voice Status Tool
// ---------------------------------------------------------------------------

export const voiceStatusTool: Tool = {
  name: 'voice_status',
  description:
    '检查语音能力状态。返回 STT 和 TTS 的配置状态、可用引擎、支持的语音列表。',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (): Promise<any> => {
    const config = _voiceService?.getConfig();
    const edgeVoices = getAvailableVoices('edge');
    const openaiVoices = getAvailableVoices('openai');

    return {
      stt: {
        configured: !!_voiceService,
        provider: config ? 'default-model' : 'none',
        language: config?.sttLanguage ?? 'zh',
      },
      tts: {
        configured: true,
        provider: config?.ttsProvider ?? 'edge',
        auto: config?.ttsAuto ?? 'off',
        voice: config?.ttsVoice ?? 'zh-CN-XiaoxiaoNeural',
        maxLength: config?.maxTtsLength ?? 2000,
      },
      availableVoices: {
        edge: edgeVoices,
        openai: openaiVoices,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerVoiceTools(executor: ToolExecutor): void {
  executor.register(sttTool);
  executor.register(ttsTool);
  executor.register(voiceStatusTool);
}
