import { stripSensitiveFields } from './types';

describe('stripSensitiveFields', () => {
  it('returns primitives unchanged', () => {
    expect(stripSensitiveFields(42)).toBe(42);
    expect(stripSensitiveFields('hello')).toBe('hello');
    expect(stripSensitiveFields(null)).toBeNull();
    expect(stripSensitiveFields(undefined)).toBeUndefined();
    expect(stripSensitiveFields(true)).toBe(true);
  });

  it('removes top-level sensitive fields', () => {
    const input = {
      name: 'test',
      api_key: 'secret-key',
      app_secret: 'shh',
      value: 123,
    };
    const result = stripSensitiveFields(input);
    expect(result).toEqual({ name: 'test', value: 123 });
  });

  it('matches sensitive keywords case-insensitively', () => {
    const input = {
      API_KEY: 'key1',
      App_Secret: 'sec',
      ACCESS_TOKEN: 'tok',
      safe: 'ok',
    };
    const result = stripSensitiveFields(input);
    expect(result).toEqual({ safe: 'ok' });
  });

  it('removes fields containing sensitive keywords as substrings', () => {
    const input = {
      broker_credential_id: 'cred123',
      my_secret_value: 'hidden',
      user_access_token_v2: 'tok',
      normal_field: 'visible',
    };
    const result = stripSensitiveFields(input);
    expect(result).toEqual({ normal_field: 'visible' });
  });

  it('recursively strips nested objects', () => {
    const input = {
      user: 'alice',
      config: {
        endpoint: 'https://api.example.com',
        credential: 'hidden',
        nested: {
          token: 'deep-secret',
          data: 'visible',
        },
      },
    };
    const result = stripSensitiveFields(input);
    expect(result).toEqual({
      user: 'alice',
      config: {
        endpoint: 'https://api.example.com',
        nested: {
          data: 'visible',
        },
      },
    });
  });

  it('handles arrays of objects', () => {
    const input = [
      { name: 'a', secret: 'x' },
      { name: 'b', token: 'y' },
    ];
    const result = stripSensitiveFields(input);
    expect(result).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('handles arrays nested in objects', () => {
    const input = {
      items: [
        { id: 1, app_key: 'k1' },
        { id: 2, value: 'safe' },
      ],
    };
    const result = stripSensitiveFields(input);
    expect(result).toEqual({
      items: [{ id: 1 }, { id: 2, value: 'safe' }],
    });
  });

  it('returns empty object when all fields are sensitive', () => {
    const input = {
      credential: 'a',
      secret: 'b',
      token: 'c',
    };
    const result = stripSensitiveFields(input);
    expect(result).toEqual({});
  });

  it('returns object unchanged when no fields are sensitive', () => {
    const input = { name: 'test', value: 42, items: [1, 2, 3] };
    const result = stripSensitiveFields(input);
    expect(result).toEqual(input);
  });

  it('handles empty objects and arrays', () => {
    expect(stripSensitiveFields({})).toEqual({});
    expect(stripSensitiveFields([])).toEqual([]);
  });
});
