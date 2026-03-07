/**
 * Tests for patchTools — unified diff parsing and application
 */

import { parseDiff, applyHunks, applyPatchTool } from './patchTools';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('patchTools', () => {
  describe('parseDiff', () => {
    it('parses a simple unified diff', () => {
      const diff = `--- a/hello.txt
+++ b/hello.txt
@@ -1,3 +1,3 @@
 line1
-line2
+line2-modified
 line3`;

      const parsed = parseDiff(diff);
      expect(parsed.oldFile).toBe('hello.txt');
      expect(parsed.newFile).toBe('hello.txt');
      expect(parsed.hunks).toHaveLength(1);
      expect(parsed.hunks[0].oldStart).toBe(1);
      expect(parsed.hunks[0].lines).toHaveLength(4);
    });

    it('parses a new file diff', () => {
      const diff = `--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,2 @@
+hello
+world`;

      const parsed = parseDiff(diff);
      expect(parsed.oldFile).toBe('/dev/null');
      expect(parsed.newFile).toBe('newfile.txt');
      expect(parsed.hunks).toHaveLength(1);
    });

    it('parses multiple hunks', () => {
      const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-old1
+new1
 same
@@ -10,2 +10,2 @@
-old10
+new10
 same10`;

      const parsed = parseDiff(diff);
      expect(parsed.hunks).toHaveLength(2);
    });
  });

  describe('applyHunks', () => {
    it('applies a simple replacement', () => {
      const original = 'line1\nline2\nline3';
      const hunks = [{
        oldStart: 1, oldCount: 3, newStart: 1, newCount: 3,
        lines: [' line1', '-line2', '+line2-modified', ' line3'],
      }];

      const result = applyHunks(original, hunks);
      expect(result).toBe('line1\nline2-modified\nline3');
    });

    it('applies an addition', () => {
      const original = 'line1\nline3';
      const hunks = [{
        oldStart: 1, oldCount: 2, newStart: 1, newCount: 3,
        lines: [' line1', '+line2', ' line3'],
      }];

      const result = applyHunks(original, hunks);
      expect(result).toBe('line1\nline2\nline3');
    });

    it('applies a deletion', () => {
      const original = 'line1\nline2\nline3';
      const hunks = [{
        oldStart: 1, oldCount: 3, newStart: 1, newCount: 2,
        lines: [' line1', '-line2', ' line3'],
      }];

      const result = applyHunks(original, hunks);
      expect(result).toBe('line1\nline3');
    });
  });

  describe('applyPatchTool.execute', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'patch-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('patches an existing file', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      await fs.writeFile(filePath, 'hello\nworld\n', 'utf-8');

      const patch = `--- a/test.txt
+++ b/test.txt
@@ -1,2 +1,2 @@
-hello
+goodbye
 world`;

      const result = await applyPatchTool.execute({ patch, basePath: tmpDir });
      expect(result.action).toBe('patched');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('goodbye');
      expect(content).not.toContain('hello');
    });

    it('creates a new file from /dev/null diff', async () => {
      const patch = `--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,2 @@
+line1
+line2`;

      const result = await applyPatchTool.execute({ patch, basePath: tmpDir });
      expect(result.action).toBe('created');

      const content = await fs.readFile(path.join(tmpDir, 'newfile.txt'), 'utf-8');
      expect(content).toBe('line1\nline2');
    });

    it('rejects empty patch', async () => {
      await expect(applyPatchTool.execute({ patch: '' })).rejects.toThrow('empty');
    });

    it('rejects path traversal', async () => {
      const patch = `--- a/../../../etc/passwd
+++ b/../../../etc/passwd
@@ -1 +1 @@
-root
+hacked`;

      await expect(applyPatchTool.execute({ patch, basePath: tmpDir })).rejects.toThrow('traversal');
    });
  });
});
