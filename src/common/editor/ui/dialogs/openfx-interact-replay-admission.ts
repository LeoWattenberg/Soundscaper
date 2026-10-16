/* SPDX-License-Identifier: AGPL-3.0-only */

import { OFX_INTERACT_MAXIMUM_EVENTS_V1 } from '../../native-ofx-interact-contract.ts';
import type { OfxInteractEventV1 } from '../../native-ofx-host-contract.ts';

/** Each admitted press must leave room for its release and the blur that commits. */
export function canAppendOpenFxInteractEvent(
	history: readonly OfxInteractEventV1[], event: OfxInteractEventV1,
): boolean {
	if (history.length >= OFX_INTERACT_MAXIMUM_EVENTS_V1) return false;
	if (event.kind === 'focus' && !event.focused) return true;
	const buttons = new Set<number>();
	const keys = new Set<string>();
	for (const value of [...history, event]) {
		if (value.kind === 'pointer' && value.phase !== 'motion') {
			if (value.phase === 'down') buttons.add(value.button);
			else buttons.delete(value.button);
		} else if (value.kind === 'keyboard') {
			if (value.phase === 'down') keys.add(value.code);
			else keys.delete(value.code);
		}
	}
	return history.length + 1 + buttons.size + keys.size + 1 <= OFX_INTERACT_MAXIMUM_EVENTS_V1;
}
