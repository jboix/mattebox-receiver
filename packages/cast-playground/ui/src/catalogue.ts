/**
 * The static content: the player demo's list, less what a Cast load cannot
 * carry. ClearKey keys and a chapters track have no place in a `LOAD`, and
 * the extensionless URL is served by the demo's own server. One entry is the
 * playground's own: the two audio languages, for `EDIT_TRACKS_INFO`.
 */

export interface StreamEntry {
  readonly label: string;
  readonly url: string;
  /** Only where the extension does not say it. */
  readonly type?: string;
  /** License server for encrypted demo streams. Goes in `customData.mattebox.licenseUrl`. */
  readonly licenseUrl?: string;
  /** The stream type the sender declares is `LIVE`. */
  readonly live?: boolean;
  readonly note?: string;
}

export const STREAMS: readonly StreamEntry[] = [
  {
    label: 'Unified Streaming · Tears of Steel',
    url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
  },
  {
    label: 'Unified Streaming · Tears of Steel, two audio languages',
    url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel-multi-lang.ism/.m3u8',
    note: 'two audio tracks, for the Tracks panel',
  },
  {
    label: 'Apple bipbop basic (HLS, MPEG-TS)',
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
    note: 'MPEG-TS segments, so the ts tier of the preset does the work',
  },
  {
    label: 'DASH-IF · Big Buck Bunny',
    url: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
  },
  {
    label: 'DASH-IF · multi-period (ad-insertion layout, test case 5a)',
    url: 'https://dash.akamaized.net/dash264/TestCases/5a/nomor/1.mpd',
  },
  {
    label: 'Mux · DAI stitched ads (HLS, 4 discontinuities)',
    url: 'https://test-streams.mux.dev/dai-discontinuity-deltatre/manifest.m3u8',
  },
  {
    label: 'SRG SSR · RTS (fr)',
    url: 'https://rts-vod-amd.akamaized.net/ww/14683290/5bb14625-55e0-328c-bb9d-d5be774abd88/master.m3u8',
  },
  {
    label: 'DASH-IF · live (livesim2)',
    url: 'https://livesim2.dashif.org/livesim2/testpic_2s/Manifest.mpd',
    live: true,
  },
  {
    label: 'SRG SSR · RTS Info (live CMAF video DVR)',
    url: 'https://rtsinfo-d.akamaized.net/out/v1/lsvs/rts-info/cmaf/hls-master.m3u8?dw=7201',
    live: true,
  },
  {
    label: 'SRG SSR · Couleur 3 (live audio DVR)',
    url: 'https://stxt-audiostreaming.akamaized.net/hls/live/2117380/couleur3/master.m3u8',
    live: true,
  },
  {
    label: 'RTS · live (muxed TS, small window)',
    url: 'https://hls-harbor-livepush.akamaized.net/live_cdn/nsqIStpj8PaG-Ev/emcQJ0pGpremocy/index.m3u8',
    live: true,
  },
  {
    label: 'Shaka · Angel One (Widevine DASH)',
    url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine/dash.mpd',
    licenseUrl: 'https://cwip-shaka-proxy.appspot.com/no_auth',
  },
  {
    label: 'Shaka · Sintel (Widevine + PlayReady DASH)',
    url: 'https://storage.googleapis.com/shaka-demo-assets/sintel-widevine/dash.mpd',
    licenseUrl: 'https://cwip-shaka-proxy.appspot.com/no_auth',
  },
  {
    label: 'Progressive mp4 (native)',
    url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
  },
  {
    label: 'mp3 (native)',
    url: 'https://download.samplelib.com/mp3/sample-3s.mp3',
    note: 'sound alone: the title stays on screen',
  },
];
