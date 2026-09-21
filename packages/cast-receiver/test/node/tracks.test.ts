import { describe, expect, it } from 'vitest';
import type { EngineTrackView } from '../../src/tracks.js';
import { createTrackIds } from '../../src/tracks.js';
import type { CastLoadTrack } from '../../src/types.js';

const SENDER: CastLoadTrack[] = [
  {
    id: 1,
    url: 'https://cdn.example/ca.vtt',
    type: 'text/vtt',
    kind: 'subtitles',
    name: 'Català',
    language: 'ca',
  },
  {
    id: 5,
    url: 'https://cdn.example/en.vtt',
    type: 'text/vtt',
    kind: 'captions',
    name: 'English',
    language: 'en',
  },
];

const ENGINE: EngineTrackView[] = [
  { id: 'video:main', contentType: 'video', mimeType: 'video/mp4' },
  { id: 'audio:en', contentType: 'audio', mimeType: 'audio/mp4', lang: 'en' },
  { id: 'audio:fr', contentType: 'audio', mimeType: 'audio/mp4', lang: 'fr' },
  { id: 'text:de', contentType: 'text', mimeType: 'text/vtt', lang: 'de', role: 'subtitle' },
];

describe('createTrackIds', () => {
  it("keeps the sender's ids and numbers the engine's tracks after them", () => {
    const ids = createTrackIds(SENDER);
    const tracks = ids.sync(ENGINE, []);
    expect(tracks.map((t) => [t.trackId, t.type, t.language])).toEqual([
      [1, 'TEXT', 'ca'],
      [5, 'TEXT', 'en'],
      [6, 'AUDIO', 'en'],
      [7, 'AUDIO', 'fr'],
      [8, 'TEXT', 'de'],
    ]);
    expect(tracks[1]?.subtype).toBe('CAPTIONS');
    expect(tracks[0]?.trackContentId).toBe('https://cdn.example/ca.vtt');
  });

  it('never moves an id once given', () => {
    const ids = createTrackIds([]);
    ids.sync([ENGINE[1] as EngineTrackView], []);
    // The manifest reloads with the list in another order and one more track.
    const tracks = ids.sync([ENGINE[3], ENGINE[2], ENGINE[1]] as EngineTrackView[], []);
    expect(tracks.map((t) => [t.trackId, t.language])).toEqual([
      [1, 'en'],
      [2, 'de'],
      [3, 'fr'],
    ]);
    expect(ids.target(3)).toEqual({ origin: 'engine', contentType: 'audio', trackId: 'audio:fr' });
    expect(ids.idOf({ origin: 'engine', contentType: 'text', trackId: 'text:de' })).toBe(2);
  });

  it('leaves out a track the session no longer has, and gives its id back when it returns', () => {
    const ids = createTrackIds([]);
    ids.sync([ENGINE[1], ENGINE[2]] as EngineTrackView[], []);
    expect(ids.sync([ENGINE[2]] as EngineTrackView[], []).map((t) => t.trackId)).toEqual([2]);
    expect(ids.sync([ENGINE[1], ENGINE[2]] as EngineTrackView[], []).map((t) => t.trackId)).toEqual(
      [1, 2],
    );
  });

  it("lists a native session's text tracks, and the sender's once", () => {
    const ids = createTrackIds([SENDER[0] as CastLoadTrack]);
    const tracks = ids.sync(null, [
      { kind: 'subtitles', label: 'Català', language: 'ca' },
      { kind: 'subtitles', label: '', language: 'it' },
      { kind: 'chapters', label: 'Chapters', language: 'en' },
    ]);
    expect(tracks.map((t) => [t.trackId, t.name])).toEqual([
      [1, 'Català'],
      [2, 'it'],
    ]);
    expect(ids.target(2)).toEqual({
      origin: 'video',
      kind: 'subtitles',
      label: '',
      language: 'it',
    });
  });

  it("ignores the video's own list for an engine session: the engine mirrors its tracks there", () => {
    const ids = createTrackIds([]);
    const tracks = ids.sync(
      [ENGINE[3] as EngineTrackView],
      [{ kind: 'subtitles', label: 'de', language: 'de' }],
    );
    expect(tracks).toHaveLength(1);
  });

  it('finds a text track by language, by its primary subtag', () => {
    const ids = createTrackIds(SENDER);
    ids.sync(ENGINE, []);
    expect(ids.byLanguage('de-CH')).toEqual({
      origin: 'engine',
      contentType: 'text',
      trackId: 'text:de',
    });
    expect(ids.byLanguage('ca')).toEqual({
      origin: 'video',
      kind: 'subtitles',
      label: 'Català',
      language: 'ca',
    });
    expect(ids.byLanguage('fr')).toBeNull();
  });

  it('answers null for an id it never gave', () => {
    expect(createTrackIds([]).target(9)).toBeNull();
  });
});
