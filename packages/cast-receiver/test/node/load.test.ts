import { describe, expect, it } from 'vitest';
import { toCastLoad } from '../../src/load.js';

describe('toCastLoad', () => {
  it('reads what the player sender sends', () => {
    const load = toCastLoad({
      requestId: 7,
      currentTime: 42.5,
      autoplay: false,
      customData: { mattebox: { licenseUrl: 'https://drm.example/wv' } },
      media: {
        contentId: 'https://cdn.example/master.m3u8',
        contentType: 'application/vnd.apple.mpegurl',
        streamType: 'BUFFERED',
        hlsSegmentFormat: 'fmp4',
        hlsVideoSegmentFormat: 'fmp4',
        tracks: [
          {
            trackId: 1,
            type: 'TEXT',
            trackContentId: 'https://cdn.example/ca.vtt',
            trackContentType: 'text/vtt',
            subtype: 'CAPTIONS',
            name: 'Català',
            language: 'ca',
          },
        ],
        metadata: {
          title: 'A title',
          subtitle: 'A subtitle',
          images: [{ url: 'https://cdn.example/a.jpg' }, {}],
        },
      },
    });
    expect(load).toEqual({
      url: 'https://cdn.example/master.m3u8',
      type: 'application/vnd.apple.mpegurl',
      streamType: 'buffered',
      currentTime: 42.5,
      autoplay: false,
      tracks: [
        {
          id: 1,
          url: 'https://cdn.example/ca.vtt',
          type: 'text/vtt',
          kind: 'captions',
          name: 'Català',
          language: 'ca',
        },
      ],
      metadata: {
        title: 'A title',
        subtitle: 'A subtitle',
        images: ['https://cdn.example/a.jpg'],
      },
      hlsSegmentFormat: 'fmp4',
      customData: { mattebox: { licenseUrl: 'https://drm.example/wv' } },
    });
  });

  it('fills what a sender leaves out', () => {
    const load = toCastLoad({ media: { contentId: 'https://cdn.example/clip' } });
    expect(load).toEqual({
      url: 'https://cdn.example/clip',
      streamType: 'buffered',
      currentTime: 0,
      autoplay: true,
      tracks: [],
      metadata: { images: [] },
      customData: null,
    });
    expect('type' in load).toBe(false);
  });

  it('takes contentUrl over contentId, and an empty type as none', () => {
    const load = toCastLoad({
      media: { contentId: 'urn:some:id', contentUrl: 'https://cdn.example/a.mpd', contentType: '' },
    });
    expect(load.url).toBe('https://cdn.example/a.mpd');
    expect(load.type).toBeUndefined();
  });

  it('reads LIVE, and the media customData when the request has none', () => {
    const load = toCastLoad({
      media: { contentId: 'x', streamType: 'LIVE', customData: { token: 't' } },
    });
    expect(load.streamType).toBe('live');
    expect(load.customData).toEqual({ token: 't' });
  });

  it('keeps text tracks with a URL and nothing else', () => {
    const load = toCastLoad({
      media: {
        contentId: 'x',
        tracks: [
          { trackId: 1, type: 'AUDIO', language: 'en' },
          { trackId: 2, type: 'TEXT' },
          { trackId: 3, type: 'TEXT', trackContentId: 'https://cdn.example/de.vtt' },
        ],
      },
    });
    expect(load.tracks).toEqual([
      {
        id: 3,
        url: 'https://cdn.example/de.vtt',
        type: 'text/vtt',
        kind: 'subtitles',
        name: '',
        language: '',
      },
    ]);
  });

  it('survives a request with no media', () => {
    expect(toCastLoad({}).url).toBe('');
  });
});
