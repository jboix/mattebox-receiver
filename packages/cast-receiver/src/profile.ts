/**
 * The memory profile: kernel tuning for the device the page runs on. A first
 * or second generation Chromecast has little memory for a MediaSource, so
 * the forward and back buffers are lowered there. The trace ring stays at
 * zero unless `debug` is on. Everything else is the engine's.
 *
 * PROVISIONAL: the two numbers and the detection below did not come from a
 * device. A run on a first generation Chromecast is what settles them.
 */
import type { KernelConfig } from 'mattebox';

/** What the library reads of the device. */
export interface DeviceView {
  readonly userAgent: string;
  /** `CastReceiverContext.getDeviceCapabilities()`, or null off a device. */
  readonly capabilities: Readonly<Record<string, unknown>> | null;
  /** `canDisplayType` for H.264 at 1080p60, or null where nothing answers. The third generation plays it, the first two do not. */
  readonly fullHd60: boolean | null;
}

export type DeviceClass = 'constrained' | 'standard';

/**
 * The framework reports no generation by name. What separates the first two
 * generations from the rest: they run the Linux runtime, so the user agent
 * carries `CrKey` and neither `Android` nor `Fuchsia`; they report no HDR,
 * which the Ultra does; and they do not display 1080p60, which the third
 * generation does.
 */
export function deviceClass(device: DeviceView): DeviceClass {
  const agent = device.userAgent;
  if (!/CrKey\//.test(agent)) return 'standard';
  if (/Android|Fuchsia/i.test(agent)) return 'standard';
  if (device.capabilities?.is_hdr_supported === true) return 'standard';
  if (device.fullHd60 === true) return 'standard';
  return 'constrained';
}

const TRACE_WHILE_DEBUGGING = 500;

export function memoryProfile(device: DeviceView, debug: boolean): Partial<KernelConfig> {
  const constrained = deviceClass(device) === 'constrained';
  return {
    ...(constrained ? { bufferGoalSeconds: 12, backBufferSeconds: 6 } : {}),
    traceCapacity: debug ? TRACE_WHILE_DEBUGGING : 0,
  };
}
