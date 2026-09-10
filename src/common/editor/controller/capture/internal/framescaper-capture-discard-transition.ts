/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureSessionManifestV1,
} from '../../../framescaper-capture-session-manifest.ts';

/**
 * The discarded manifest a capture session can still settle into, or `null` when
 * its state has moved past discarding.
 *
 * An ordinary live stop writes `finalizing` with no recovery decision before
 * canonical publication completes, so a crash inside that window must stay
 * discardable: it is the state a recovery offer presents, and refusing it strands
 * the session and its spool bytes across every later launch. A `published`
 * manifest has already adopted immutable media and settles through commit and
 * retirement instead, and a decided `finalizing` manifest cannot revise the
 * recovery decision it recorded.
 */
export function discardedFramescaperCaptureManifest(
	manifest: FramescaperCaptureSessionManifestV1,
	updatedAt: number,
): FramescaperCaptureSessionManifestV1 | null {
	const discardable = manifest.state === 'sealed'
		|| (manifest.state === 'finalizing' && manifest.recoveryDecision === null);
	if (!discardable) return null;
	return normalizeFramescaperCaptureSessionManifest({
		...manifest,
		state: 'discarded',
		recoveryDecision: 'delete',
		updatedAt,
	});
}
