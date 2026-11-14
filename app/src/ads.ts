/**
 * The ads of the sender's page, on the television. The sender's ads add-on
 * sends the schedule the page gave it, and this module gives it to the same
 * add-on here: the VAST and VMAP URLs, and the breaks. Optional:
 * `resolve.ts` imports it only for a load that carries an `ads` section, so
 * a cast without ads fetches no ad code.
 *
 * The section applies to a programme made of what the sender sent. A
 * programme this page's own connector resolved has its own ads.
 */
import type { CastProgramme } from '@mattebox/cast-receiver';
import { CAST_CONNECTOR } from '@mattebox/cast-receiver';
import type { MatteboxPlayerElement } from '@mattebox/player';
import type { AdsRemoteData } from '@mattebox/player-ads';
import { ads, adsOf } from '@mattebox/player-ads';

let following = false;

/** Attaches the add-on to the player, once, and gives it the sent schedule at each session. */
export function follow(player: MatteboxPlayerElement): void {
  if (following) return;
  following = true;
  // Attached here and given to no `define()`: the add-on's listener has to
  // be on the player before the one below. It clears its schedule at each
  // session, and the sent schedule is given after that.
  ads().attach?.(player);
  player.addEventListener('sourcechange', (event) => {
    const programme = player.programme;
    if (event.detail === null || programme?.type !== CAST_CONNECTOR) return;
    const sent = (programme.data as CastProgramme).addons.ads as AdsRemoteData | undefined;
    for (const url of sent?.urls ?? []) void adsOf(player).load(url);
    if (sent?.breaks !== undefined) adsOf(player).schedule(sent.breaks);
  });
}
