import { describe, expect, it } from 'vitest';
import { CAST_CONNECTOR, castConnector } from '../../src/connector.js';

const signal = new AbortController().signal;

describe('the library connector', () => {
  it('resolves what the sender sent to its source and its metadata', async () => {
    const connector = castConnector();
    const source = { url: 'https://cdn.example/master.m3u8', start: 12 };
    const metadata = { title: 'Title', markers: [{ start: 1, end: 2, kind: 'blocked' }] };
    expect(connector.type).toBe(CAST_CONNECTOR);
    expect(await connector.resolve({ source, metadata, addons: {} }, signal)).toEqual({
      sources: [source],
      metadata,
    });
  });

  it('takes data only, and resolves a source without metadata', async () => {
    const connector = castConnector();
    const source = { url: 'https://cdn.example/a.mp4' };
    expect(connector.fetch).toBeUndefined();
    expect(await connector.resolve({ source, addons: {} }, signal)).toEqual({ sources: [source] });
  });
});
