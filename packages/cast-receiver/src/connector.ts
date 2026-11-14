/**
 * The library's connector. A sender that plays a programme of a connector
 * sends the connector's type and the programme's id. A receiver page with
 * the same connector resolves the id itself. A page without it still has
 * what the sender sent: the source, the metadata, the markers. This
 * connector gives them to the player as a programme, so the player applies
 * them as it does for any connector.
 */
import type { Connector } from '@mattebox/player-core';
import type { CastProgramme } from './types.js';

/** The type of a programme made of what the sender sent. */
export const CAST_CONNECTOR = 'mattebox/cast';

/** Takes data only: the bridge gives it the sender's, and there is nothing to fetch. */
export function castConnector(): Connector<CastProgramme> {
  return {
    type: CAST_CONNECTOR,
    resolve(data) {
      return {
        sources: [data.source],
        ...(data.metadata === undefined ? {} : { metadata: data.metadata }),
      };
    },
  };
}
