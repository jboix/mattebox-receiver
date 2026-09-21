import { describe, expect, it } from 'vitest';
import { deviceClass, memoryProfile } from '../../src/profile.js';

const DONGLE =
  'Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.225 Safari/537.36 CrKey/1.56.500000 DeviceType/Chromecast';
const GOOGLE_TV =
  'Mozilla/5.0 (Linux; Android 12.0; Build/STTL.240206.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 CrKey/1.56.500000 DeviceType/AndroidTV';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36';

describe('deviceClass', () => {
  it('takes a Linux dongle with no HDR and no 1080p60 for a first or second generation', () => {
    const device = {
      userAgent: DONGLE,
      capabilities: { is_hdr_supported: false },
      fullHd60: false,
    };
    expect(deviceClass(device)).toBe('constrained');
  });

  it('stays constrained while the framework has not answered yet', () => {
    expect(deviceClass({ userAgent: DONGLE, capabilities: null, fullHd60: null })).toBe(
      'constrained',
    );
  });

  it('takes the third generation, the Ultra and Google TV for standard', () => {
    expect(deviceClass({ userAgent: DONGLE, capabilities: {}, fullHd60: true })).toBe('standard');
    expect(
      deviceClass({ userAgent: DONGLE, capabilities: { is_hdr_supported: true }, fullHd60: null }),
    ).toBe('standard');
    expect(deviceClass({ userAgent: GOOGLE_TV, capabilities: null, fullHd60: null })).toBe(
      'standard',
    );
  });

  it('takes a desktop browser for standard', () => {
    expect(deviceClass({ userAgent: DESKTOP, capabilities: null, fullHd60: null })).toBe(
      'standard',
    );
  });
});

describe('memoryProfile', () => {
  it('lowers the two buffers on a constrained device and nothing else', () => {
    const profile = memoryProfile(
      { userAgent: DONGLE, capabilities: null, fullHd60: false },
      false,
    );
    expect(Object.keys(profile).sort()).toEqual([
      'backBufferSeconds',
      'bufferGoalSeconds',
      'traceCapacity',
    ]);
    expect(profile.bufferGoalSeconds).toBeLessThan(30);
    expect(profile.backBufferSeconds).toBeLessThan(30);
    expect(profile.traceCapacity).toBe(0);
  });

  it('leaves the buffers to the engine elsewhere, and keeps a trace only while debugging', () => {
    const device = { userAgent: DESKTOP, capabilities: null, fullHd60: null };
    expect(memoryProfile(device, false)).toEqual({ traceCapacity: 0 });
    expect(memoryProfile(device, true).traceCapacity).toBeGreaterThan(0);
  });
});
