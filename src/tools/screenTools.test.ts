/**
 * Screen Tools Tests
 */

import { screenCaptureTool, screenRecordTool, registerScreenTools } from './screenTools';
import { ToolExecutor } from './ToolExecutor';

// Mock child_process
jest.mock('child_process', () => ({
  execFile: jest.fn(),
  spawn: jest.fn(),
}));

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  unlink: jest.fn().mockResolvedValue(undefined),
  mkdtemp: jest.fn().mockResolvedValue('/tmp/openpilot-screen-test'),
}));

const { execFile } = require('child_process');
const { readFile } = require('fs/promises');

describe('Screen Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('screenCaptureTool', () => {
    it('should have correct name and parameters', () => {
      expect(screenCaptureTool.name).toBe('screenCapture');
      expect(screenCaptureTool.parameters.properties).toHaveProperty('display');
      expect(screenCaptureTool.parameters.properties).toHaveProperty('region');
    });

    it('should capture screenshot and return base64', async () => {
      const fakePng = Buffer.from('fake-png-data');
      execFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, '', '');
      });
      readFile.mockResolvedValue(fakePng);

      const result = await screenCaptureTool.execute({}) as any;

      expect(result.format).toBe('png');
      expect(result.base64).toBe(fakePng.toString('base64'));
      expect(result.sizeKB).toBeDefined();
    });

    it('should pass region parameters on macOS', async () => {
      const fakePng = Buffer.from('fake-png');
      execFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        // Verify -R flag is passed
        expect(args).toContain('-R');
        expect(args).toContain('100,200,800,600');
        cb(null, '', '');
      });
      readFile.mockResolvedValue(fakePng);

      await screenCaptureTool.execute({
        region: { x: 100, y: 200, width: 800, height: 600 },
      });

      expect(execFile).toHaveBeenCalled();
    });

    it('should pass display parameter on macOS', async () => {
      const fakePng = Buffer.from('fake-png');
      execFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        expect(args).toContain('-D');
        expect(args).toContain('2');
        cb(null, '', '');
      });
      readFile.mockResolvedValue(fakePng);

      await screenCaptureTool.execute({ display: 2 });

      expect(execFile).toHaveBeenCalled();
    });
  });

  describe('screenRecordTool', () => {
    it('should have correct name and required parameters', () => {
      expect(screenRecordTool.name).toBe('screenRecord');
      expect(screenRecordTool.parameters.required).toContain('action');
      expect(screenRecordTool.parameters.properties).toHaveProperty('action');
      expect(screenRecordTool.parameters.properties).toHaveProperty('duration');
    });

    it('should return not_recording when stopping without active recording', async () => {
      const result = await screenRecordTool.execute({ action: 'stop' }) as any;
      expect(result.status).toBe('not_recording');
    });

    it('should reject unknown action', async () => {
      await expect(screenRecordTool.execute({ action: 'pause' }))
        .rejects.toThrow('Unknown action');
    });
  });

  describe('registerScreenTools', () => {
    it('should register both tools with ToolExecutor', () => {
      const executor = new ToolExecutor();
      registerScreenTools(executor);

      expect(executor.hasTool('screenCapture')).toBe(true);
      expect(executor.hasTool('screenRecord')).toBe(true);
    });
  });
});
