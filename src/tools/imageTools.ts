/**
 * Image Generation Tool
 *
 * Registers `image_generation_tool` with the ToolExecutor.
 * LLM outputs a prompt → Tool calls ImageRouter → saves image to file.
 *
 * Fail-Fast: if no provider configured, returns clear error immediately.
 * Files saved to ~/.openpilot/generated/, queued for channel delivery.
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';
import { ImageRouter, ImageGenerationResult } from '../services/ImageRouter';
import type { PendingFile } from './documentTools';

// Shared pending files reference — injected from index.ts
let _pendingFiles: PendingFile[] | null = null;

/** Inject the shared pending files array (called from index.ts). */
export function setImagePendingFiles(files: PendingFile[]): void {
  _pendingFiles = files;
}

let _imageRouter: ImageRouter | null = null;

/** Set the shared ImageRouter instance (called from index.ts). */
export function setImageRouter(router: ImageRouter): void {
  _imageRouter = router;
}

async function getOutputDir(): Promise<string> {
  const dir = join(homedir(), '.openpilot', 'generated');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

export const imageGenerationTool: Tool = {
  name: 'image_generation_tool',
  description:
    '生成图片。输入文字描述（prompt），返回生成的图片文件。' +
    '支持指定 provider（qwen/stability/openai/local_sd）、尺寸（如 1024x1024）、数量。' +
    '如果未配置图片生成能力，会返回明确的错误提示。生成的图片会自动发送给用户。',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '图片描述文字（英文效果更好）',
      },
      provider: {
        type: 'string',
        description: '图片生成 Provider（可选，默认使用配置的 provider）',
      },
      size: {
        type: 'string',
        description: '图片尺寸，如 "1024x1024"、"512x512"（可选）',
      },
      n: {
        type: 'number',
        description: '生成数量（可选，默认 1）',
      },
      negative_prompt: {
        type: 'string',
        description: '负面提示词，描述不想出现的内容（可选）',
      },
    },
    required: ['prompt'],
  },
  execute: async (params: Record<string, unknown>): Promise<any> => {
    if (!_imageRouter) {
      throw new Error('🖼️ 图片生成服务未初始化。请检查系统配置。');
    }

    const result: ImageGenerationResult = await _imageRouter.generate({
      prompt: params.prompt as string,
      provider: params.provider as string | undefined,
      size: params.size as string | undefined,
      n: params.n as number | undefined,
      negativePrompt: params.negative_prompt as string | undefined,
    });

    const outputDir = await getOutputDir();
    const savedImages: Array<{ filePath: string; filename: string; sizeKB: number }> = [];

    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      const filename = `img_${Date.now()}_${i}.${img.format}`;
      const filePath = join(outputDir, filename);
      await writeFile(filePath, Buffer.from(img.base64, 'base64'));
      const sizeKB = Math.round(img.sizeBytes / 1024);
      savedImages.push({ filePath, filename, sizeKB });

      // Queue for channel delivery
      if (_pendingFiles) {
        _pendingFiles.push({
          filePath, filename, format: img.format,
          title: (params.prompt as string).slice(0, 50),
          sizeKB, createdAt: Date.now(),
        });
      }
    }

    return {
      success: true,
      provider: result.provider,
      model: result.model,
      durationMs: result.durationMs,
      imageCount: savedImages.length,
      images: savedImages.map((img, i) => ({
        index: i,
        filename: img.filename,
        sizeKB: img.sizeKB,
        filePath: img.filePath,
      })),
      note: `已生成 ${savedImages.length} 张图片，将自动发送给用户。`,
    };
  },
};

export function registerImageTools(executor: ToolExecutor): void {
  executor.register(imageGenerationTool);
}
