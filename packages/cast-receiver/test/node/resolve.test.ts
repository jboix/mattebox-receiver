import { describe, expect, it } from 'vitest';
import { defaultResolve, headersFor, matteboxData } from '../../src/resolve.js';
import type { CastLoad } from '../../src/types.js';

function load(customData: unknown, type?: string): CastLoad {
  return {
    url: 'https://cdn.example/master.m3u8',
    ...(type === undefined ? {} : { type }),
    streamType: 'buffered',
    currentTime: 0,
    autoplay: true,
    tracks: [],
    metadata: { images: [] },
    customData,
  };
}

describe('defaultResolve', () => {
  it('passes the URL and the type through', () => {
    expect(defaultResolve(load(null, 'application/dash+xml'))).toEqual({
      url: 'https://cdn.example/master.m3u8',
      type: 'application/dash+xml',
    });
  });

  it('reads customData.mattebox and nothing else', () => {
    const resolved = defaultResolve(
      load({
        token: 'ignored',
        licenseUrl: 'https://ignored.example',
        mattebox: {
          licenseUrl: 'https://drm.example/wv',
          licenseHeaders: { 'x-token': 'abc', bad: 3 },
          thumbnails: 'https://cdn.example/sprites.vtt',
        },
      }),
    );
    expect(resolved.licenseUrl).toBe('https://drm.example/wv');
    expect(resolved.thumbnails).toBe('https://cdn.example/sprites.vtt');
    expect(resolved.requestHooks).toHaveLength(1);

    const license = { url: 'https://drm.example/wv', headers: {} as Record<string, string> };
    const segment = { url: 'https://cdn.example/seg1.m4s', headers: {} as Record<string, string> };
    for (const hook of resolved.requestHooks ?? []) {
      hook(license);
      hook(segment);
    }
    expect(license.headers).toEqual({ 'x-token': 'abc' });
    expect(segment.headers).toEqual({});
  });

  it('builds no hook for headers with no license URL', () => {
    const resolved = defaultResolve(load({ mattebox: { licenseHeaders: { a: 'b' } } }));
    expect(resolved.requestHooks).toBeUndefined();
  });

  it('drops members of the wrong type', () => {
    expect(matteboxData({ mattebox: { licenseUrl: 3, thumbnails: null } })).toEqual({});
    expect(matteboxData({ mattebox: 'nope' })).toEqual({});
    expect(matteboxData('nope')).toEqual({});
  });
});

describe('headersFor', () => {
  it('writes over a header the request already has', () => {
    const request = { url: 'https://drm.example/wv', headers: { authorization: 'old' } };
    headersFor('https://drm.example/wv', { authorization: 'new' })(request);
    expect(request.headers.authorization).toBe('new');
  });
});

describe('DRM servers in customData.mattebox', () => {
  it('reads licenseUrls and certificateUrl, keeping only strings', () => {
    const resolved = defaultResolve(
      load({
        mattebox: {
          licenseUrls: { 'com.widevine.alpha': 'https://drm.example/wv', bad: 1 },
          certificateUrl: 'https://drm.example/cert',
        },
      }),
    );
    expect(resolved).toMatchObject({
      licenseUrls: { 'com.widevine.alpha': 'https://drm.example/wv' },
      certificateUrl: 'https://drm.example/cert',
    });
  });

  it('puts the license headers on every license server', () => {
    const [hook] =
      defaultResolve(
        load({
          mattebox: {
            licenseUrl: 'https://drm.example/any',
            licenseUrls: { 'com.microsoft.playready': 'https://drm.example/pr' },
            licenseHeaders: { Authorization: 'Bearer abc' },
          },
        }),
      ).requestHooks ?? [];
    const to = (url: string) => {
      const request = { url, headers: {} as Record<string, string> };
      hook?.(request);
      return request.headers;
    };
    expect(to('https://drm.example/any')).toEqual({ Authorization: 'Bearer abc' });
    expect(to('https://drm.example/pr')).toEqual({ Authorization: 'Bearer abc' });
    expect(to('https://cdn.example/master.m3u8')).toEqual({});
  });
});
