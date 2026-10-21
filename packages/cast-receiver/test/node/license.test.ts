import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLicenseChannel } from '../../src/license.js';
import type { ReceiverPlayer } from '../../src/types.js';

afterEach(() => {
  vi.useRealTimers();
});

function channel(senders = true) {
  const sent: unknown[] = [];
  const drm = { setLicenseUrl: vi.fn(), setLicenseUrls: vi.fn() };
  const player = { engine: { drm } } as unknown as ReceiverPlayer;
  const license = createLicenseChannel(
    (message) => {
      sent.push(message);
      return senders;
    },
    () => player,
  );
  license.loaded({ url: 'https://cdn.example/m.mpd', licenseUrl: 'https://drm.example/wv' });
  return { license, sent, drm };
}

function headersOn(license: ReturnType<typeof channel>['license'], url: string) {
  const request = { url, headers: { Authorization: 'Bearer old' } as Record<string, string> };
  license.hook(request);
  return request.headers;
}

describe('the license token channel', () => {
  it('asks the senders, and puts the replied headers on the license requests', async () => {
    const { license, sent } = channel();
    const asked = license.onUnauthorized({ keySystem: 'com.widevine.alpha', status: 401 });
    expect(sent).toEqual([
      { type: 'unauthorized', id: 1, keySystem: 'com.widevine.alpha', status: 401 },
    ]);
    // Before the reply the load's own headers stand.
    expect(headersOn(license, 'https://drm.example/wv')).toEqual({ Authorization: 'Bearer old' });
    license.onMessage({ type: 'license', id: 1, licenseHeaders: { Authorization: 'Bearer new' } });
    await asked;
    expect(headersOn(license, 'https://drm.example/wv')).toEqual({ Authorization: 'Bearer new' });
    expect(headersOn(license, 'https://cdn.example/seg.m4s')).toEqual({
      Authorization: 'Bearer old',
    });
  });

  it('gives the engine replied license servers, and their requests take the headers', async () => {
    const { license, drm } = channel();
    const asked = license.onUnauthorized({ keySystem: 'com.widevine.alpha', status: 403 });
    license.onMessage({
      type: 'license',
      id: 1,
      licenseUrls: { 'com.widevine.alpha': 'https://drm.example/wv?sig=2' },
      licenseHeaders: { 'x-token': 'two' },
    });
    await asked;
    expect(drm.setLicenseUrls).toHaveBeenCalledWith({
      'com.widevine.alpha': 'https://drm.example/wv?sig=2',
    });
    expect(headersOn(license, 'https://drm.example/wv?sig=2')['x-token']).toBe('two');
  });

  it('ignores a reply to another request, and other messages', async () => {
    vi.useFakeTimers();
    const { license } = channel();
    let done = false;
    void license.onUnauthorized({ keySystem: 'k', status: 401 }).then(() => {
      done = true;
    });
    license.onMessage({ type: 'license', id: 9, licenseHeaders: { a: 'b' } });
    license.onMessage({ type: 'other', id: 1 });
    license.onMessage('text');
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    // No reply in 10 s: the request goes again unchanged.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(true);
    expect(headersOn(license, 'https://drm.example/wv')).toEqual({ Authorization: 'Bearer old' });
  });

  it('returns at once without a sender', async () => {
    const { license } = channel(false);
    await expect(license.onUnauthorized({ keySystem: 'k', status: 401 })).resolves.toBeUndefined();
  });

  it('a new load forgets the last reply', async () => {
    const { license } = channel();
    const asked = license.onUnauthorized({ keySystem: 'k', status: 401 });
    license.onMessage({ type: 'license', id: 1, licenseHeaders: { Authorization: 'Bearer new' } });
    await asked;
    license.loaded({ url: 'https://cdn.example/n.mpd', licenseUrl: 'https://drm.example/wv' });
    expect(headersOn(license, 'https://drm.example/wv')).toEqual({ Authorization: 'Bearer old' });
  });
});
