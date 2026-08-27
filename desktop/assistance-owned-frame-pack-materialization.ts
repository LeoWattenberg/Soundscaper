/* SPDX-License-Identifier: AGPL-3.0-only */

import { reviewAssistanceVisualFramePack } from
	'../src/common/editor/assistance/visual-frame-pack-v2.ts';
import type { AssistanceOwnedFramePackPlanV1 } from
	'../src/common/editor/assistance/owned-video-highlight-transform-types-v1.ts';

export function assertAssistanceOwnedFramePackMatchesPlanV1(
	packs: readonly (readonly Uint8Array[])[],
	plan: AssistanceOwnedFramePackPlanV1,
): void {
	if (!Array.isArray(packs) || packs.length < 1 || packs.length > 64) {
		throw new RangeError('Materialized frame-pack inventory exceeds its exact bound.');
	}
	let ordinal = 0;
	for (const chunks of packs) {
		const reviewed = reviewAssistanceVisualFramePack(chunks);
		if (reviewed.sourceWidth !== plan.width || reviewed.sourceHeight !== plan.height
			|| reviewed.timescale !== plan.timescale || reviewed.frameCount < 1) {
			throw new RangeError('Materialized frame-pack geometry disagrees with its deterministic plan.');
		}
		for (let index = 0; index < reviewed.frameCount; index += 1) {
			const frame = reviewed.frame(index);
			const expected = plan.frames[ordinal];
			if (!expected || frame.sourceFrame !== expected.sourceFrame
				|| frame.presentationTick !== expected.presentationTick) {
				throw new RangeError('Materialized frame-pack timing disagrees with its deterministic plan.');
			}
			ordinal += 1;
		}
	}
	if (ordinal !== plan.frames.length) {
		throw new RangeError('Materialized frame-pack inventory disagrees with its deterministic plan.');
	}
}
