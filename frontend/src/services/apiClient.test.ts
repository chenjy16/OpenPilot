import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get, post, put, del, ApiError } from './apiClient';

describe('apiClient', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- GET ---
  it('get() sends GET request with correct URL and headers', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: '1' }));

    const result = await get('/sessions');

    expect(mockFetch).toHaveBeenCalledWith('/api/sessions', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(result).toEqual({ id: '1' });
  });

  // --- POST ---
  it('post() sends POST request with JSON body', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    const result = await post('/sessions', { title: 'New' });

    expect(mockFetch).toHaveBeenCalledWith('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New' }),
    });
    expect(result).toEqual({ success: true });
  });

  it('post() sends POST without body when none provided', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await post('/sessions/1/compact');

    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/1/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
  });

  // --- PUT ---
  it('put() sends PUT request with JSON body', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ updated: true }));

    const result = await put('/system/env', { key: 'NODE_ENV', value: 'prod' });

    expect(mockFetch).toHaveBeenCalledWith('/api/system/env', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'NODE_ENV', value: 'prod' }),
    });
    expect(result).toEqual({ updated: true });
  });

  // --- DELETE ---
  it('del() sends DELETE request', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    const result = await del('/sessions/abc');

    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/abc', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(result).toEqual({ success: true });
  });

  // --- Error handling ---
  it('throws ApiError with status and message from JSON error body', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Not found' }), { status: 404, statusText: 'Not Found' }),
    );

    await expect(get('/sessions/missing')).rejects.toThrow(ApiError);
    try {
      await get('/sessions/missing');
    } catch (e) {
      // re-trigger for assertion since first already consumed
    }

    // Verify error properties via a fresh call
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Not found' }), { status: 404, statusText: 'Not Found' }),
    );
    try {
      await get('/sessions/missing');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(404);
      expect((e as ApiError).message).toBe('Not found');
    }
  });

  it('throws ApiError with error field from body', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, statusText: 'Forbidden' }),
    );

    try {
      await del('/sessions/x');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).message).toBe('Forbidden');
    }
  });

  it('falls back to statusText when body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    try {
      await get('/broken');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).message).toBe('Internal Server Error');
    }
  });

  // --- 204 No Content ---
  it('handles 204 No Content responses', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await del('/sessions/abc');

    expect(result).toBeUndefined();
  });
});
