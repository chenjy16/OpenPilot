/**
 * Document Generation Tools
 *
 * Tools:
 *   - pdf_generation_tool: Markdown → HTML → PDF
 *   - ppt_generation_tool: JSON slides → .pptx
 *
 * Design:
 *   - LLM outputs structured data (Markdown / JSON)
 *   - Tools do deterministic rendering via libraries
 *   - Fail-Fast if dependencies missing
 *   - Files saved to disk, only metadata returned to LLM (no base64 in tool result)
 *   - Pending files queue for ChannelManager to deliver as documents
 */

import { writeFile, mkdtemp, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { Tool } from '../types';
import { ToolExecutor } from './ToolExecutor';

// ---------------------------------------------------------------------------
// Pending files queue — ChannelManager reads this after tool execution
// ---------------------------------------------------------------------------

export interface PendingFile {
  filePath: string;
  filename: string;
  format: string;
  title: string;
  sizeKB: number;
  createdAt: number;
}

const pendingFiles: PendingFile[] = [];

/** Get and clear all pending files (called by ChannelManager after AI response). */
export function drainPendingFiles(): PendingFile[] {
  return pendingFiles.splice(0, pendingFiles.length);
}

/** Get the shared pending files array reference (for imageTools to push into). */
export function getPendingFilesRef(): PendingFile[] {
  return pendingFiles;
}

/** Get the output directory for generated files. */
async function getOutputDir(): Promise<string> {
  const dir = join(homedir(), '.openpilot', 'generated');
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

// ---------------------------------------------------------------------------
// PDF Generation Tool
// ---------------------------------------------------------------------------

export const pdfGenerationTool: Tool = {
  name: 'pdf_generation_tool',
  description:
    '将 Markdown 内容生成 PDF 文件。输入 Markdown 文本，返回 base64 编码的 PDF。' +
    '支持中文、代码高亮、表格等。可选传入样式配置。',
  parameters: {
    type: 'object',
    properties: {
      markdown_content: {
        type: 'string',
        description: 'Markdown 格式的文档内容',
      },
      title: {
        type: 'string',
        description: '文档标题（可选，用于文件名）',
      },
      style: {
        type: 'object',
        description: '样式配置（可选）：{ fontSize, fontFamily, pageSize, margin }',
      },
    },
    required: ['markdown_content'],
  },
  execute: async (params: Record<string, unknown>): Promise<any> => {
    const markdown = params.markdown_content as string;
    const title = (params.title as string) ?? 'document';
    const style = (params.style as Record<string, any>) ?? {};

    // Convert Markdown to HTML manually (simple but effective)
    const html = markdownToHtml(markdown, style, title);
    const outputDir = await getOutputDir();
    const filename = `${sanitizeFilename(title)}_${Date.now()}`;

    // Try Puppeteer for PDF rendering
    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = await htmlToPdfPuppeteer(html, style);
    } catch {
      // Puppeteer not available — save as HTML
    }

    if (pdfBuffer) {
      const filePath = join(outputDir, `${filename}.pdf`);
      await writeFile(filePath, pdfBuffer);
      const sizeKB = Math.round(pdfBuffer.length / 1024);

      pendingFiles.push({ filePath, filename: `${filename}.pdf`, format: 'pdf', title, sizeKB, createdAt: Date.now() });

      return {
        success: true,
        format: 'pdf',
        title,
        sizeKB,
        filePath,
        note: `PDF 已生成 (${sizeKB} KB)，将自动发送文件给用户。`,
      };
    }

    // Fallback: save as HTML
    const htmlPath = join(outputDir, `${filename}.html`);
    await writeFile(htmlPath, html, 'utf-8');
    const sizeKB = Math.round(Buffer.from(html).length / 1024);

    pendingFiles.push({ filePath: htmlPath, filename: `${filename}.html`, format: 'html', title, sizeKB, createdAt: Date.now() });

    return {
      success: true,
      format: 'html',
      title,
      sizeKB,
      filePath: htmlPath,
      note: `已生成 HTML 文件 (${sizeKB} KB)。PDF 渲染需要 puppeteer，当前以 HTML 格式发送。`,
    };
  },
};

// ---------------------------------------------------------------------------
// PPT Generation Tool
// ---------------------------------------------------------------------------

interface SlideData {
  title?: string;
  content?: string[];
  image_prompt?: string;
  notes?: string;
  layout?: 'title' | 'content' | 'image' | 'two_column';
}

export const pptGenerationTool: Tool = {
  name: 'ppt_generation_tool',
  description:
    '生成 PowerPoint (.pptx) 文件。输入幻灯片 JSON 数组，返回 base64 编码的 .pptx 文件。' +
    '每个 slide 包含 title、content（要点数组）、image_prompt（可选配图描述）、layout。',
  parameters: {
    type: 'object',
    properties: {
      slides: {
        type: 'array',
        description: '幻灯片数组，每项: { title, content: string[], image_prompt?, notes?, layout? }',
      },
      title: {
        type: 'string',
        description: 'PPT 标题（用于文件名和封面）',
      },
      author: {
        type: 'string',
        description: '作者名（可选）',
      },
      theme: {
        type: 'object',
        description: '主题配置（可选）：{ primaryColor, backgroundColor, fontFace }',
      },
    },
    required: ['slides'],
  },
  execute: async (params: Record<string, unknown>): Promise<any> => {
    let PptxGenJS: any;
    try {
      PptxGenJS = require('pptxgenjs');
    } catch {
      throw new Error(
        '📊 PPT 生成需要 pptxgenjs 库。请运行: npm install pptxgenjs',
      );
    }

    const slides = params.slides as SlideData[];
    const title = (params.title as string) ?? 'Presentation';
    const author = (params.author as string) ?? 'OpenPilot';
    const theme = (params.theme as Record<string, any>) ?? {};

    const pptx = new PptxGenJS();
    pptx.title = title;
    pptx.author = author;
    pptx.layout = 'LAYOUT_WIDE';

    const primaryColor = theme.primaryColor ?? '2563EB';
    const bgColor = theme.backgroundColor ?? 'FFFFFF';
    const fontFace = theme.fontFace ?? 'Microsoft YaHei';

    for (let i = 0; i < slides.length; i++) {
      const slideData = slides[i];
      const slide = pptx.addSlide();
      slide.background = { color: bgColor };

      const layout = slideData.layout ?? (i === 0 ? 'title' : 'content');

      if (layout === 'title') {
        // Title slide
        slide.addText(slideData.title ?? title, {
          x: 0.5, y: 1.5, w: '90%', h: 1.5,
          fontSize: 36, fontFace, color: primaryColor,
          bold: true, align: 'center',
        });
        if (slideData.content?.length) {
          slide.addText(slideData.content.join('\n'), {
            x: 0.5, y: 3.5, w: '90%', h: 1,
            fontSize: 18, fontFace, color: '666666',
            align: 'center',
          });
        }
      } else {
        // Content slide with title bar
        slide.addShape('rect' as any, {
          x: 0, y: 0, w: '100%', h: 0.8,
          fill: { color: primaryColor },
        });
        slide.addText(slideData.title ?? '', {
          x: 0.5, y: 0.1, w: '90%', h: 0.6,
          fontSize: 24, fontFace, color: 'FFFFFF', bold: true,
        });

        // Bullet points
        if (slideData.content?.length) {
          const bulletText = slideData.content.map(item => ({
            text: item,
            options: { bullet: true, fontSize: 18, fontFace, color: '333333', breakLine: true },
          }));
          slide.addText(bulletText as any, {
            x: 0.5, y: 1.2, w: '90%', h: 4,
            valign: 'top',
          });
        }
      }

      // Notes
      if (slideData.notes) {
        slide.addNotes(slideData.notes);
      }
    }

    // Write to file (persist, not temp)
    const outputDir = await getOutputDir();
    const filename = `${sanitizeFilename(title)}_${Date.now()}.pptx`;
    const filePath = join(outputDir, filename);
    await pptx.writeFile({ fileName: filePath });

    const buffer = await readFile(filePath);
    const sizeKB = Math.round(buffer.length / 1024);

    // Queue for channel delivery
    pendingFiles.push({ filePath, filename, format: 'pptx', title, sizeKB, createdAt: Date.now() });

    return {
      success: true,
      format: 'pptx',
      title,
      slideCount: slides.length,
      sizeKB,
      filePath,
      note: `PPT 已生成 (${slides.length} 页, ${sizeKB} KB)，将自动发送文件给用户。`,
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 100);
}

function markdownToHtml(md: string, style: Record<string, any>, title: string): string {
  // Simple Markdown → HTML converter (handles common patterns)
  let html = md
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold / Italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="$1">$2</code></pre>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br>');

  // Wrap loose <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>)+/gs, '<ul>$&</ul>');

  const fontSize = style.fontSize ?? '14px';
  const fontFamily = style.fontFamily ?? "'Microsoft YaHei', 'Noto Sans SC', sans-serif";
  const pageSize = style.pageSize ?? 'A4';
  const margin = style.margin ?? '2cm';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page { size: ${pageSize}; margin: ${margin}; }
  body { font-family: ${fontFamily}; font-size: ${fontSize}; line-height: 1.6; color: #333; }
  h1 { font-size: 2em; border-bottom: 2px solid #2563EB; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; color: #1e40af; }
  h3 { font-size: 1.2em; color: #374151; }
  pre { background: #f3f4f6; padding: 1em; border-radius: 6px; overflow-x: auto; }
  code { background: #f3f4f6; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d1d5db; padding: 0.5em 1em; text-align: left; }
  th { background: #f9fafb; font-weight: bold; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 2em 0; }
  ul { padding-left: 1.5em; }
</style>
</head>
<body><p>${html}</p></body>
</html>`;
}

async function htmlToPdfPuppeteer(html: string, style: Record<string, any>): Promise<Buffer> {
  let puppeteer: any;
  try {
    puppeteer = require('puppeteer');
  } catch {
    throw new Error('puppeteer not available');
  }

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: style.pageSize ?? 'A4',
      margin: { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' },
      printBackground: true,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDocumentTools(executor: ToolExecutor): void {
  executor.register(pdfGenerationTool);
  executor.register(pptGenerationTool);
}
