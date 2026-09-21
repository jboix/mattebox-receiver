import full from 'mattebox/presets/full';
import { describe, expect, it } from 'vitest';
import { chain, createHookRouter } from '../../src/handlers.js';

describe('the handler chain', () => {
  it('is the mattebox handler, then the native handler', () => {
    const router = createHookRouter();
    const handlers = chain({ preset: full, config: {}, hook: router.hook });
    expect(handlers.map((handler) => handler.name)).toEqual(['mattebox', 'native']);
  });

  it('routes both protocols to the one engine and an mp4 past it', () => {
    const [engine] = chain({ preset: full, config: {}, hook: createHookRouter().hook });
    const env = { video: {} as HTMLMediaElement, mse: true };
    const can = (type?: string) =>
      engine?.canHandle(
        { url: 'https://cdn.example/x', ...(type === undefined ? {} : { type }) },
        env,
      );
    expect(can('application/vnd.apple.mpegurl')).toBe('probably');
    expect(can('application/dash+xml')).toBe('probably');
    expect(can('video/mp4')).toBe('');
    // No type still reaches the engine, and the adapters sniff the manifest.
    expect(can()).toBe('maybe');
  });
});

describe('the hook router', () => {
  it('calls the hooks of the current load, and none after they are cleared', () => {
    const router = createHookRouter();
    const request = { url: 'https://cdn.example/a', headers: {} as Record<string, string> };
    router.hook(request);
    expect(request.headers).toEqual({});

    router.set([
      (r) => {
        r.headers.a = '1';
      },
      (r) => {
        r.url = `${r.url}?token=t`;
      },
    ]);
    router.hook(request);
    expect(request).toEqual({ url: 'https://cdn.example/a?token=t', headers: { a: '1' } });

    router.set([]);
    const next = { url: 'https://cdn.example/b', headers: {} as Record<string, string> };
    router.hook(next);
    expect(next).toEqual({ url: 'https://cdn.example/b', headers: {} });
  });
});
