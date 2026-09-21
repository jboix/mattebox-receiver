import { describe, expect, it } from 'vitest';
import { playerState } from '../../src/status.js';

describe('playerState', () => {
  const playing = { loaded: true, paused: false, ended: false, waiting: false };

  it('reads the four states from the video and the player', () => {
    expect(playerState(playing)).toBe('PLAYING');
    expect(playerState({ ...playing, paused: true })).toBe('PAUSED');
    expect(playerState({ ...playing, waiting: true })).toBe('BUFFERING');
    expect(playerState({ ...playing, ended: true, paused: true })).toBe('IDLE');
    expect(playerState({ ...playing, loaded: false })).toBe('IDLE');
  });

  it('is paused, not buffering, while a paused video waits', () => {
    expect(playerState({ ...playing, paused: true, waiting: true })).toBe('PAUSED');
  });
});
