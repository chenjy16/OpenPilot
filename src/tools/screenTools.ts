/**
 * Screen Tools
 *
 * System-level screenshot and screen recording tools.
 * Uses macOS native `screencapture` command. On Linux falls back to
 * `import` (ImageMagick) or `gnome-screenshot`.
 *
 * Tools:
 *   - screenCapture: Take a screenshot of the desktop or a specific display
 *   - screenRecord:  Record a screen video clip (macOS only)
 */

import { execFile, spawn, ChildProcess } from 'child_process';
import { readFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';

const platform = process.platform;

// Active recording process (only one at a time)
let activeRecording: { proc: ChildProcess; filePath: string; startedAt: number } | null = null;

/**
 * Execute a command and return stdout/stderr.
 */
function execAsync(cmd: string, args: string[], timeoutMs = 15_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// screenCapture
// ---------------------------------------------------------------------------

export const screenCaptureTool: Tool = {
  name: 'screenCapture',
  description:
    'Take a screenshot of the entire screen or a specific region. Returns a base64-encoded PNG image. ' +
    'On macOS uses native screencapture; on Linux uses import (ImageMagick) or gnome-screenshot.',
  parameters: {
    type: 'object',
    properties: {
      display: {
        type: 'number',
        description: 'Display number to capture (macOS: 1=main, 2=secondary). Default: main display.',
      },
      region: {
        type: 'object',
        description: 'Capture a specific region: { x, y, width, height } in pixels. If omitted, captures full screen.',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
      windowTitle: {
        type: 'string',
        description: 'macOS only: capture a specific window by title (uses -l flag with window ID lookup).',
      },
    },
  },
  execute: async (params: Record<string, unknown>) => {
    const dir = await mkdtemp(join(tmpdir(), 'openpilot-screen-'));
    const filePath = join(dir, 'capture.png');

    try {
      if (platform === 'darwin') {
        await captureMacOS(filePath, params);
      } else if (platform === 'linux') {
        await captureLinux(filePath, params);
      } else {
        throw new Error(`Screen capture not supported on ${platform}. Supported: macOS, Linux.`);
      }

      const buffer = await readFile(filePath);
      const base64 = buffer.toString('base64');
      const sizeKB = Math.round(buffer.length / 1024);

      return {
        format: 'png',
        base64,
        sizeKB,
        platform,
      };
    } finally {
      // Cleanup temp file
      await unlink(filePath).catch(() => {});
    }
  },
};

async function captureMacOS(filePath: string, params: Record<string, unknown>): Promise<void> {
  const args: string[] = ['-x', '-t', 'png']; // -x = no sound

  const region = params.region as { x: number; y: number; width: number; height: number } | undefined;
  if (region) {
    // -R x,y,w,h — capture a specific rectangle
    args.push('-R', `${region.x},${region.y},${region.width},${region.height}`);
  }

  const display = params.display as number | undefined;
  if (display && !region) {
    // -D display_number
    args.push('-D', String(display));
  }

  args.push(filePath);
  await execAsync('screencapture', args);
}

async function captureLinux(filePath: string, params: Record<string, unknown>): Promise<void> {
  const region = params.region as { x: number; y: number; width: number; height: number } | undefined;

  // Try ImageMagick `import` first
  try {
    if (region) {
      const geometry = `${region.width}x${region.height}+${region.x}+${region.y}`;
      await execAsync('import', ['-window', 'root', '-crop', geometry, filePath]);
    } else {
      await execAsync('import', ['-window', 'root', filePath]);
    }
    return;
  } catch {
    // Fall through to gnome-screenshot
  }

  // Fallback: gnome-screenshot
  try {
    const args = ['-f', filePath];
    if (region) {
      args.push('-a'); // area mode (interactive — not ideal for automation)
    }
    await execAsync('gnome-screenshot', args);
  } catch {
    throw new Error(
      'No screenshot tool found. Install ImageMagick (`sudo apt install imagemagick`) ' +
      'or gnome-screenshot (`sudo apt install gnome-screenshot`).',
    );
  }
}

// ---------------------------------------------------------------------------
// screenRecord
// ---------------------------------------------------------------------------

export const screenRecordTool: Tool = {
  name: 'screenRecord',
  description:
    'Start or stop a screen recording. ' +
    'Call with action="start" to begin recording, action="stop" to end and get the video. ' +
    'macOS uses native screencapture -v; Linux uses ffmpeg with x11grab. ' +
    'Returns base64-encoded video on stop (MOV on macOS, MP4 on Linux).',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '"start" to begin recording, "stop" to end recording and return the video.',
        enum: ['start', 'stop'],
      },
      duration: {
        type: 'number',
        description: 'Max recording duration in seconds (default: 30, max: 120). Recording auto-stops after this.',
      },
      display: {
        type: 'number',
        description: 'Display number to record (default: main display).',
      },
    },
    required: ['action'],
  },
  execute: async (params: Record<string, unknown>) => {
    const action = params.action as string;

    if (action === 'start') {
      return startRecording(params);
    } else if (action === 'stop') {
      return stopRecording();
    } else {
      throw new Error(`Unknown action: ${action}. Use "start" or "stop".`);
    }
  },
};

async function startRecording(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (activeRecording) {
    return { status: 'already_recording', startedAt: activeRecording.startedAt };
  }

  const maxDuration = Math.min((params.duration as number | undefined) ?? 30, 120);
  const dir = await mkdtemp(join(tmpdir(), 'openpilot-record-'));

  if (platform === 'darwin') {
    const filePath = join(dir, 'recording.mov');
    // screencapture -v -V <duration> <file>
    const args = ['-v', '-V', String(maxDuration)];
    const display = params.display as number | undefined;
    if (display) args.push('-D', String(display));
    args.push(filePath);

    const proc = spawn('screencapture', args, { stdio: 'ignore' });
    activeRecording = { proc, filePath, startedAt: Date.now() };

    // Auto-stop safety net
    setTimeout(() => {
      if (activeRecording?.proc === proc) {
        proc.kill('SIGINT');
      }
    }, (maxDuration + 5) * 1000);

    return { status: 'recording', format: 'mov', maxDuration, filePath };

  } else if (platform === 'linux') {
    const filePath = join(dir, 'recording.mp4');
    const display = (params.display as string) ?? ':0';
    // ffmpeg -f x11grab -video_size 1920x1080 -i :0 -t <duration> <file>
    const proc = spawn('ffmpeg', [
      '-f', 'x11grab',
      '-video_size', '1920x1080',
      '-framerate', '15',
      '-i', String(display),
      '-t', String(maxDuration),
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-y',
      filePath,
    ], { stdio: 'ignore' });

    activeRecording = { proc, filePath, startedAt: Date.now() };

    setTimeout(() => {
      if (activeRecording?.proc === proc) {
        proc.kill('SIGINT');
      }
    }, (maxDuration + 5) * 1000);

    return { status: 'recording', format: 'mp4', maxDuration, filePath };

  } else {
    throw new Error(`Screen recording not supported on ${platform}.`);
  }
}

async function stopRecording(): Promise<Record<string, unknown>> {
  if (!activeRecording) {
    return { status: 'not_recording' };
  }

  const { proc, filePath, startedAt } = activeRecording;
  const durationSec = Math.round((Date.now() - startedAt) / 1000);

  // Send SIGINT to gracefully stop recording
  proc.kill('SIGINT');

  // Wait for process to exit (max 10s)
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 10_000);
    proc.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  activeRecording = null;

  // Read the recorded file
  try {
    const buffer = await readFile(filePath);
    const base64 = buffer.toString('base64');
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
    const format = filePath.endsWith('.mov') ? 'mov' : 'mp4';

    // Cleanup
    await unlink(filePath).catch(() => {});

    return {
      status: 'stopped',
      format,
      base64,
      sizeMB,
      durationSec,
    };
  } catch {
    return {
      status: 'stopped',
      error: 'Recording file not found. The recording may have been too short or failed.',
      durationSec,
    };
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerScreenTools(executor: ToolExecutor): void {
  executor.register(screenCaptureTool);
  executor.register(screenRecordTool);
}
