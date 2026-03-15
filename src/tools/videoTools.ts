/**
 * Video Editing Tools
 *
 * Tools:
 *   - video_probe_tool: Extract video metadata via ffprobe
 *   - video_edit_tool: Render video edits from Timeline JSON via ffmpeg
 *
 * Design:
 *   - LLM outputs structured Timeline JSON (never raw ffmpeg commands)
 *   - Tools do deterministic rendering via local ffmpeg
 *   - Fail-Fast if ffmpeg/ffprobe not installed
 *   - Files saved to disk, queued for channel delivery via PendingFiles
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';
import type { PendingFile } from './documentTools';
import type { AppConfig } from '../config/index';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Shared state — injected from index.ts
// ---------------------------------------------------------------------------

let _pendingFiles: PendingFile[] | null = null;
let _appConfig: AppConfig | null = null;

/** Inject the shared pending files array (called from index.ts). */
export function setVideoPendingFiles(files: PendingFile[]): void {
  _pendingFiles = files;
}

/** Inject the live appConfig reference (called from index.ts). */
export function setVideoConfig(config: AppConfig): void {
  _appConfig = config;
}

// ---------------------------------------------------------------------------
// FFmpeg Guardian (Fail-Fast)
// ---------------------------------------------------------------------------

interface FFmpegStatus {
  available: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  version: string | null;
}

let _cachedStatus: FFmpegStatus | null = null;

/** Check ffmpeg and ffprobe availability. Caches result. */
export async function checkFFmpeg(): Promise<FFmpegStatus> {
  if (_cachedStatus) return _cachedStatus;

  const ffmpegBin = _appConfig?.video?.ffmpegPath || 'ffmpeg';
  const ffprobeBin = ffmpegBin.replace(/ffmpeg$/, 'ffprobe');

  let ffmpegPath: string | null = null;
  let ffprobePath: string | null = null;
  let version: string | null = null;

  try {
    const { stdout } = await execFileAsync(ffmpegBin, ['-version'], { timeout: 5000 });
    ffmpegPath = ffmpegBin;
    const match = stdout.match(/ffmpeg version (\S+)/);
    version = match?.[1] ?? 'unknown';
  } catch { /* not available */ }

  try {
    await execFileAsync(ffprobeBin, ['-version'], { timeout: 5000 });
    ffprobePath = ffprobeBin;
  } catch { /* not available */ }

  _cachedStatus = {
    available: !!ffmpegPath && !!ffprobePath,
    ffmpegPath,
    ffprobePath,
    version,
  };
  return _cachedStatus;
}

/** Assert ffmpeg is available. Throws descriptive error if not. */
export async function assertFFmpegAvailable(): Promise<void> {
  const status = await checkFFmpeg();
  if (!status.available) {
    const missing: string[] = [];
    if (!status.ffmpegPath) missing.push('ffmpeg');
    if (!status.ffprobePath) missing.push('ffprobe');
    throw new Error(
      `🎬 视频工具不可用：未检测到 ${missing.join(' 和 ')}。\n` +
      `请安装 FFmpeg 后重试。安装命令：brew install ffmpeg`
    );
  }
}

// ---------------------------------------------------------------------------
// Timeline JSON types & validation
// ---------------------------------------------------------------------------

const VALID_ACTIONS = ['trim', 'add_subtitle', 'speed_up', 'add_bgm', 'transition'] as const;
type TrackAction = typeof VALID_ACTIONS[number];

interface TrackParameters {
  text?: string;
  font_size?: number;
  position?: 'top' | 'center' | 'bottom';
  music_style?: string;
  speed_factor?: number;
  transition_type?: 'fade' | 'dissolve' | 'wipe';
  transition_duration?: number;
}

interface TimelineTrack {
  action: TrackAction;
  start_time?: number;
  end_time?: number;
  parameters?: TrackParameters;
}

interface TimelineJSON {
  output_format: 'mp4' | 'gif' | 'webm';
  resolution?: '1080p' | '720p' | 'vertical_9_16';
  tracks: TimelineTrack[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate Timeline JSON against source video duration. */
export function validateTimeline(timeline: TimelineJSON, sourceDuration: number): ValidationResult {
  const errors: string[] = [];

  if (!['mp4', 'gif', 'webm'].includes(timeline.output_format)) {
    errors.push(`无效的输出格式: ${timeline.output_format}`);
  }

  if (!timeline.tracks || timeline.tracks.length === 0) {
    errors.push('tracks 不能为空');
    return { valid: false, errors };
  }

  for (let i = 0; i < timeline.tracks.length; i++) {
    const track = timeline.tracks[i];
    if (!VALID_ACTIONS.includes(track.action as any)) {
      errors.push(`track[${i}]: 无效的 action "${track.action}"`);
      continue;
    }

    if (track.action === 'trim') {
      if (track.start_time == null || track.end_time == null) {
        errors.push(`track[${i}]: trim 必须指定 start_time 和 end_time`);
      } else {
        if (track.start_time < 0) errors.push(`track[${i}]: start_time 不能为负数`);
        if (track.start_time >= track.end_time) errors.push(`track[${i}]: start_time 必须小于 end_time`);
        if (track.end_time > sourceDuration) errors.push(`track[${i}]: end_time (${track.end_time}) 超过视频时长 (${sourceDuration})`);
      }
    }

    if (track.action === 'speed_up') {
      const factor = track.parameters?.speed_factor;
      if (factor == null || factor < 0.25 || factor > 4.0) {
        errors.push(`track[${i}]: speed_factor 必须在 [0.25, 4.0] 范围内`);
      }
    }

    if (track.action === 'add_subtitle') {
      if (!track.parameters?.text) {
        errors.push(`track[${i}]: add_subtitle 必须指定 text 参数`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// FFmpeg command builder
// ---------------------------------------------------------------------------

const RESOLUTION_MAP: Record<string, string> = {
  '1080p': '1920:1080',
  '720p': '1280:720',
  'vertical_9_16': '1080:1920',
};

/** Escape text for FFmpeg drawtext filter. */
export function escapeFFmpegText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/%/g, '%%');
}

/** Clamp atempo value to FFmpeg's valid range [0.5, 100]. Chain if needed. */
function buildAtempoFilters(factor: number): string[] {
  // FFmpeg atempo range is [0.5, 100.0]. For factors outside, chain multiple.
  const filters: string[] = [];
  let remaining = factor;
  while (remaining > 100.0) {
    filters.push('atempo=100.0');
    remaining /= 100.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining}`);
  return filters;
}

/** Build FFmpeg arguments from Timeline JSON. */
export function buildFFmpegArgs(
  sourcePath: string,
  timeline: TimelineJSON,
  outputPath: string,
): string[] {
  const args: string[] = [];
  const videoFilters: string[] = [];
  const audioFilters: string[] = [];

  // Handle trim: use input seeking for performance
  const trimTrack = timeline.tracks.find(t => t.action === 'trim');
  if (trimTrack && trimTrack.start_time != null) {
    args.push('-ss', String(trimTrack.start_time));
    if (trimTrack.end_time != null) {
      args.push('-to', String(trimTrack.end_time));
    }
  }

  args.push('-i', sourcePath);

  // Process non-trim tracks
  for (const track of timeline.tracks) {
    if (track.action === 'trim') continue; // already handled above

    if (track.action === 'speed_up' && track.parameters?.speed_factor) {
      const factor = track.parameters.speed_factor;
      videoFilters.push(`setpts=PTS/${factor}`);
      audioFilters.push(...buildAtempoFilters(factor));
    }

    if (track.action === 'add_subtitle' && track.parameters?.text) {
      const text = escapeFFmpegText(track.parameters.text);
      const pos = track.parameters.position ?? 'bottom';
      const fontSize = track.parameters.font_size ?? 24;
      const y = pos === 'top' ? '50' : pos === 'center' ? '(h-text_h)/2' : 'h-th-50';
      videoFilters.push(
        `drawtext=text='${text}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${y}`
      );
    }
  }

  if (videoFilters.length > 0) {
    args.push('-vf', videoFilters.join(','));
  }
  if (audioFilters.length > 0) {
    args.push('-af', audioFilters.join(','));
  }

  // Resolution
  const resolution = timeline.resolution ? RESOLUTION_MAP[timeline.resolution] : null;
  if (resolution) {
    args.push('-s', resolution);
  }

  args.push('-y', outputPath);
  return args;
}

// ---------------------------------------------------------------------------
// Video probe (ffprobe)
// ---------------------------------------------------------------------------

interface VideoProbeResult {
  filePath: string;
  duration: number;
  resolution: string;
  codec: string;
  fps: number;
  bitrate: number;
  fileSize: number;
  hasAudio: boolean;
}

function parseFps(rFrameRate?: string): number {
  if (!rFrameRate) return 0;
  const parts = rFrameRate.split('/');
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    return den > 0 ? Math.round((num / den) * 100) / 100 : 0;
  }
  return parseFloat(rFrameRate) || 0;
}

async function probeVideo(filePath: string): Promise<VideoProbeResult> {
  await assertFFmpegAvailable();

  const ffprobeBin = _appConfig?.video?.ffmpegPath?.replace(/ffmpeg$/, 'ffprobe') || 'ffprobe';
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  const { stdout } = await execFileAsync(ffprobeBin, args, { timeout: 15_000 });
  const data = JSON.parse(stdout);

  const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
  const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');

  if (!videoStream && !data.format?.duration) {
    throw new Error('无法解析视频文件，请确认文件格式正确。');
  }

  return {
    filePath,
    duration: parseFloat(data.format?.duration ?? '0'),
    resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : 'unknown',
    codec: videoStream?.codec_name ?? 'unknown',
    fps: parseFps(videoStream?.r_frame_rate),
    bitrate: parseInt(data.format?.bit_rate ?? '0', 10) / 1000,
    fileSize: parseInt(data.format?.size ?? '0', 10),
    hasAudio: !!audioStream,
  };
}

// ---------------------------------------------------------------------------
// Output directory helper
// ---------------------------------------------------------------------------

async function getVideoOutputDir(): Promise<string> {
  const configured = _appConfig?.video?.outputDir;
  const resolved = configured
    ? configured.replace(/^~/, homedir())
    : join(homedir(), '.openpilot', 'generated', 'video');
  if (!existsSync(resolved)) {
    await mkdir(resolved, { recursive: true });
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const videoProbeTool: Tool = {
  name: 'video_probe_tool',
  description:
    '探测视频文件的元数据信息。输入视频文件路径，返回时长、分辨率、编码格式、帧率、比特率等信息。' +
    '用于在编辑视频前了解视频的基本属性。',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: '视频文件的本地路径',
      },
    },
    required: ['file_path'],
  },
  execute: async (params: Record<string, unknown>): Promise<any> => {
    const filePath = params.file_path as string;
    if (!filePath) throw new Error('缺少 file_path 参数');

    if (!existsSync(filePath)) {
      throw new Error(`视频文件不存在: ${filePath}`);
    }

    // Check file size limit
    const maxMB = _appConfig?.video?.maxInputSize ?? 500;
    const fileStat = await stat(filePath);
    if (fileStat.size > maxMB * 1024 * 1024) {
      throw new Error(`视频文件过大 (${Math.round(fileStat.size / 1024 / 1024)} MB)，超过限制 (${maxMB} MB)。`);
    }

    const result = await probeVideo(filePath);
    return {
      ...result,
      fileSizeMB: Math.round(result.fileSize / 1024 / 1024 * 100) / 100,
      note: `视频时长 ${result.duration.toFixed(1)}s，分辨率 ${result.resolution}，编码 ${result.codec}，${result.hasAudio ? '有音轨' : '无音轨'}。`,
    };
  },
};

export const videoEditTool: Tool = {
  name: 'video_edit_tool',
  description:
    '视频编辑渲染工具。接收源视频路径和 Timeline JSON，执行裁剪、变速、加字幕等操作。' +
    'Timeline JSON 是唯一的编辑指令格式，绝不直接输出 FFmpeg 命令。' +
    '支持的 action: trim（裁剪）、speed_up（变速）、add_subtitle（加字幕）。' +
    '渲染完成后文件会自动发送给用户。',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: '源视频文件路径',
      },
      timeline: {
        type: 'object',
        description: 'Timeline JSON 编辑指令',
        properties: {
          output_format: { type: 'string', description: '输出格式，如 mp4、webm' },
          resolution: { type: 'string', description: '分辨率，如 1920x1080（可选）' },
          tracks: {
            type: 'array',
            description: '编辑轨道数组',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', description: '操作: trim | speed_up | add_subtitle' },
                start_time: { type: 'number', description: '开始时间（秒）' },
                end_time: { type: 'number', description: '结束时间（秒）' },
                parameters: { type: 'object', description: '操作参数' },
              },
              required: ['action'],
            },
          },
        },
        required: ['output_format', 'tracks'],
      },
    },
    required: ['source', 'timeline'],
  },
  execute: async (params: Record<string, unknown>): Promise<any> => {
    const sourcePath = params.source as string;
    const timeline = params.timeline as TimelineJSON;

    if (!sourcePath) throw new Error('缺少 source 参数');
    if (!timeline || !timeline.tracks) throw new Error('缺少 timeline 参数或 tracks 为空');

    if (!existsSync(sourcePath)) {
      throw new Error(`源视频文件不存在: ${sourcePath}`);
    }

    // Step 1: Fail-Fast
    await assertFFmpegAvailable();

    // Step 2: Probe source video
    const probe = await probeVideo(sourcePath);

    // Step 3: Validate timeline
    const validation = validateTimeline(timeline, probe.duration);
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
        note: `Timeline 校验失败: ${validation.errors.join('; ')}`,
      };
    }

    // Step 4: Build output path
    const outputDir = await getVideoOutputDir();
    const ext = timeline.output_format || 'mp4';
    const outputPath = join(outputDir, `video_${Date.now()}.${ext}`);

    // Step 5: Build and execute FFmpeg
    const ffmpegBin = _appConfig?.video?.ffmpegPath || 'ffmpeg';
    const args = buildFFmpegArgs(sourcePath, timeline, outputPath);
    const timeout = _appConfig?.video?.renderTimeout ?? 120_000;

    try {
      await execFileAsync(ffmpegBin, args, { timeout });
    } catch (err: any) {
      if (err.killed) {
        throw new Error(`渲染超时 (${Math.round(timeout / 1000)}s)。建议缩短视频或降低分辨率。`);
      }
      throw new Error(`渲染失败: ${err.message?.slice(0, 300)}`);
    }

    // Step 6: Get output info
    const outputStat = await stat(outputPath);
    const sizeKB = Math.round(outputStat.size / 1024);
    const filename = basename(outputPath);

    // Queue for channel delivery
    if (_pendingFiles) {
      _pendingFiles.push({
        filePath: outputPath,
        filename,
        format: ext,
        title: `视频编辑_${new Date().toISOString().slice(0, 10)}`,
        sizeKB,
        createdAt: Date.now(),
      });
    }

    return {
      success: true,
      filePath: outputPath,
      filename,
      format: ext,
      sizeKB,
      durationSec: probe.duration,
      note: `视频已渲染 (${sizeKB} KB)，将自动发送给用户。`,
    };
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerVideoTools(executor: ToolExecutor): void {
  executor.register(videoProbeTool);
  executor.register(videoEditTool);
}
