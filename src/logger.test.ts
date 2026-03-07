/**
 * Tests for structured logger
 */

import { Logger, createLogger, configureLogging } from './logger';

describe('Logger', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log info messages', () => {
    const logger = new Logger('Test', 'info');
    logger.info('Hello world');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Hello world'));
  });

  it('should respect log level', () => {
    const logger = new Logger('Test', 'warn');
    logger.info('Should not appear');
    logger.debug('Should not appear');
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('should mask sensitive data', () => {
    const logger = new Logger('Test', 'info');
    logger.info('Key: sk-1234567890abcdefghijklmnop');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('sk-[MASKED]'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.not.stringContaining('1234567890'));
  });

  it('should output JSON in json mode', () => {
    const logger = new Logger('Test', 'info', true);
    logger.info('JSON test');
    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('JSON test');
    expect(parsed.module).toBe('Test');
  });

  it('should create child loggers', () => {
    const parent = new Logger('Parent', 'info');
    const child = parent.child('Child');
    child.info('From child');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Parent:Child'));
  });

  it('should include metadata', () => {
    const logger = new Logger('Test', 'info');
    logger.info('With meta', { key: 'value' });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"key":"value"'));
  });
});

describe('createLogger', () => {
  it('should create a logger with global settings', () => {
    configureLogging('debug');
    const logger = createLogger('MyModule');
    expect(logger).toBeInstanceOf(Logger);
  });
});
