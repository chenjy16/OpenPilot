/**
 * InboundDebouncer unit tests
 */
import { InboundDebouncer } from './InboundDebouncer';
import { ChannelMessage } from './types';

function makeMessage(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    senderId: 'user1',
    senderName: 'Test User',
    channelType: 'telegram',
    chatId: 'chat1',
    content: 'hello',
    timestamp: new Date(),
    ...overrides,
  };
}

describe('InboundDebouncer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('delivers a single message after window expires', () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    const debouncer = new InboundDebouncer(callback, { windowMs: 500 });

    debouncer.enqueue(makeMessage({ content: 'hello' }));
    expect(callback).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].content).toBe('hello');

    debouncer.dispose();
  });

  it('merges consecutive messages from same sender', () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    const debouncer = new InboundDebouncer(callback, { windowMs: 500 });

    debouncer.enqueue(makeMessage({ content: 'line 1' }));
    debouncer.enqueue(makeMessage({ content: 'line 2' }));
    debouncer.enqueue(makeMessage({ content: 'line 3' }));

    jest.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].content).toBe('line 1\nline 2\nline 3');

    debouncer.dispose();
  });

  it('keeps messages from different senders separate', () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    const debouncer = new InboundDebouncer(callback, { windowMs: 500 });

    debouncer.enqueue(makeMessage({ senderId: 'alice', content: 'from alice' }));
    debouncer.enqueue(makeMessage({ senderId: 'bob', content: 'from bob' }));

    jest.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(2);

    debouncer.dispose();
  });

  it('flushes immediately when maxMerge is reached', () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    const debouncer = new InboundDebouncer(callback, { windowMs: 5000, maxMerge: 3 });

    debouncer.enqueue(makeMessage({ content: 'a' }));
    debouncer.enqueue(makeMessage({ content: 'b' }));
    debouncer.enqueue(makeMessage({ content: 'c' }));

    // Should flush immediately without waiting for timer
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].content).toBe('a\nb\nc');

    debouncer.dispose();
  });

  it('shouldDebounce returns false for long messages', () => {
    const debouncer = new InboundDebouncer(jest.fn());
    const longMsg = makeMessage({ content: 'x'.repeat(201) });
    expect(debouncer.shouldDebounce(longMsg)).toBe(false);
    debouncer.dispose();
  });

  it('shouldDebounce returns false for messages with attachments', () => {
    const debouncer = new InboundDebouncer(jest.fn());
    const msg = makeMessage({ attachments: [{ type: 'image', url: 'http://example.com/img.png' }] });
    expect(debouncer.shouldDebounce(msg)).toBe(false);
    debouncer.dispose();
  });

  it('shouldDebounce returns true for short text messages', () => {
    const debouncer = new InboundDebouncer(jest.fn());
    expect(debouncer.shouldDebounce(makeMessage({ content: 'hi' }))).toBe(true);
    debouncer.dispose();
  });

  it('dispose cancels pending timers', () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    const debouncer = new InboundDebouncer(callback, { windowMs: 500 });

    debouncer.enqueue(makeMessage());
    expect(debouncer.pendingCount).toBe(1);

    debouncer.dispose();
    expect(debouncer.pendingCount).toBe(0);

    jest.advanceTimersByTime(500);
    expect(callback).not.toHaveBeenCalled();
  });

  it('resets timer on each new message', () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    const debouncer = new InboundDebouncer(callback, { windowMs: 500 });

    debouncer.enqueue(makeMessage({ content: 'first' }));
    jest.advanceTimersByTime(300);
    debouncer.enqueue(makeMessage({ content: 'second' }));
    jest.advanceTimersByTime(300);
    // Only 600ms total, but timer was reset at 300ms, so 300ms since last
    expect(callback).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    // Now 500ms since last message
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].content).toBe('first\nsecond');

    debouncer.dispose();
  });
});
