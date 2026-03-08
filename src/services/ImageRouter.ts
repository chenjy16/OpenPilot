/**
 * Image Provider Router
 *
 * Routes image generation requests to the configured provider.
 * Supports: Qwen Image, Stability AI, Local Stable Diffusion, OpenAI DALL-E.
 *
 * Design:
 *   - Fail-Fast: no provider configured → immediate clear error
 *   - Provider-agnostic Tool interface
 *   - Config-driven provider selection
 */

import type { AppConfig } from '../config/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageGenerationRequest {
  prompt: string;
  provider?: string;
  size?: string;
  n?: number;
  negativePrompt?: string;
  style?: string;
}

export interface ImageGenerationResult {
  images: Array<{
    base64: string;
    format: string;
    sizeBytes: number;
  }>;
  provider: string;
  model: string;
  durationMs: number;
}

interface ProviderConfig {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  endpoint?: string;
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function generateQwen(req: ImageGenerationRequest, cfg: ProviderConfig): Promise<ImageGenerationResult> {
  const start = Date.now();
  const baseUrl = cfg.baseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = cfg.model ?? 'wanx-v1';

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: req.prompt,
      n: req.n ?? 1,
      size: req.size ?? '1024x1024',
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Qwen 图片生成失败: ${response.status} ${err.slice(0, 200)}`);
  }

  const result = await response.json() as any;
  const images = await Promise.all(
    (result.data ?? []).map(async (item: any) => {
      if (item.b64_json) {
        const buf = Buffer.from(item.b64_json, 'base64');
        return { base64: item.b64_json, format: 'png', sizeBytes: buf.length };
      }
      if (item.url) {
        const imgRes = await fetch(item.url);
        const buf = Buffer.from(await imgRes.arrayBuffer());
        return { base64: buf.toString('base64'), format: 'png', sizeBytes: buf.length };
      }
      throw new Error('Qwen 返回数据格式异常');
    }),
  );

  return { images, provider: 'qwen', model, durationMs: Date.now() - start };
}

async function generateStability(req: ImageGenerationRequest, cfg: ProviderConfig): Promise<ImageGenerationResult> {
  const start = Date.now();
  const model = cfg.model ?? 'stable-diffusion-xl-1024-v1-0';
  const baseUrl = cfg.baseUrl ?? 'https://api.stability.ai';

  const response = await fetch(`${baseUrl}/v1/generation/${model}/text-to-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      text_prompts: [
        { text: req.prompt, weight: 1 },
        ...(req.negativePrompt ? [{ text: req.negativePrompt, weight: -1 }] : []),
      ],
      cfg_scale: 7,
      width: parseInt(req.size?.split('x')[0] ?? '1024', 10),
      height: parseInt(req.size?.split('x')[1] ?? '1024', 10),
      samples: req.n ?? 1,
      steps: 30,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Stability AI 图片生成失败: ${response.status} ${err.slice(0, 200)}`);
  }

  const result = await response.json() as any;
  const images = (result.artifacts ?? []).map((art: any) => ({
    base64: art.base64,
    format: 'png',
    sizeBytes: Buffer.from(art.base64, 'base64').length,
  }));

  return { images, provider: 'stability', model, durationMs: Date.now() - start };
}

async function generateLocalSD(req: ImageGenerationRequest, cfg: ProviderConfig): Promise<ImageGenerationResult> {
  const start = Date.now();
  const endpoint = cfg.endpoint ?? 'http://127.0.0.1:7860';

  const response = await fetch(`${endpoint}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: req.prompt,
      negative_prompt: req.negativePrompt ?? '',
      width: parseInt(req.size?.split('x')[0] ?? '512', 10),
      height: parseInt(req.size?.split('x')[1] ?? '512', 10),
      batch_size: req.n ?? 1,
      steps: 20,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`本地 SD 图片生成失败: ${response.status} ${err.slice(0, 200)}`);
  }

  const result = await response.json() as any;
  const images = (result.images ?? []).map((b64: string) => ({
    base64: b64,
    format: 'png',
    sizeBytes: Buffer.from(b64, 'base64').length,
  }));

  return { images, provider: 'local_sd', model: 'local', durationMs: Date.now() - start };
}

async function generateOpenAI(req: ImageGenerationRequest, cfg: ProviderConfig): Promise<ImageGenerationResult> {
  const start = Date.now();
  const model = cfg.model ?? 'dall-e-3';
  const baseUrl = cfg.baseUrl ?? 'https://api.openai.com/v1';

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: req.prompt,
      n: req.n ?? 1,
      size: req.size ?? '1024x1024',
      response_format: 'b64_json',
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`OpenAI 图片生成失败: ${response.status} ${err.slice(0, 200)}`);
  }

  const result = await response.json() as any;
  const images = (result.data ?? []).map((item: any) => ({
    base64: item.b64_json,
    format: 'png',
    sizeBytes: Buffer.from(item.b64_json, 'base64').length,
  }));

  return { images, provider: 'openai', model, durationMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const PROVIDER_MAP: Record<string, (req: ImageGenerationRequest, cfg: ProviderConfig) => Promise<ImageGenerationResult>> = {
  qwen: generateQwen,
  stability: generateStability,
  local_sd: generateLocalSD,
  openai: generateOpenAI,
};

export class ImageRouter {
  private defaultProvider: string;
  private providers: Record<string, ProviderConfig>;

  constructor(config?: AppConfig) {
    const imgCfg = (config as any)?.imageGeneration;
    this.defaultProvider = imgCfg?.provider ?? '';
    this.providers = imgCfg?.providers ?? {};
  }

  /** Update config at runtime (e.g. after config reload). */
  updateConfig(config: AppConfig): void {
    const imgCfg = (config as any)?.imageGeneration;
    this.defaultProvider = imgCfg?.provider ?? '';
    this.providers = imgCfg?.providers ?? {};
  }

  /** Check if image generation is configured. */
  isConfigured(): boolean {
    const provider = this.defaultProvider;
    if (!provider) return false;
    const cfg = this.providers[provider];
    if (!cfg) return false;
    // local_sd only needs endpoint
    if (provider === 'local_sd') return Boolean(cfg.endpoint);
    return Boolean(cfg.apiKey);
  }

  /** Generate images. Fail-Fast if not configured. */
  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const providerName = req.provider ?? this.defaultProvider;

    if (!providerName) {
      throw new Error(
        '🖼️ 当前环境未配置图片生成能力。\n' +
        '请在 config.json5 中配置 imageGeneration.provider 和对应的 API Key。\n' +
        '支持的 Provider: qwen, stability, openai, local_sd',
      );
    }

    const cfg = this.providers[providerName];
    if (!cfg) {
      throw new Error(
        `🖼️ 图片生成 Provider "${providerName}" 未配置。\n` +
        `请在 config.json5 的 imageGeneration.providers.${providerName} 中添加配置。`,
      );
    }

    // Fail-Fast: check API key (except local_sd)
    if (providerName !== 'local_sd' && !cfg.apiKey) {
      throw new Error(
        `🖼️ Provider "${providerName}" 缺少 API Key。\n` +
        `请在 config.json5 的 imageGeneration.providers.${providerName}.apiKey 中配置。`,
      );
    }

    const handler = PROVIDER_MAP[providerName];
    if (!handler) {
      throw new Error(
        `🖼️ 不支持的图片生成 Provider: "${providerName}"。\n` +
        `支持的 Provider: ${Object.keys(PROVIDER_MAP).join(', ')}`,
      );
    }

    console.log(`[ImageRouter] Generating image via "${providerName}" — prompt: "${req.prompt.slice(0, 60)}..."`);
    return handler(req, cfg);
  }
}
