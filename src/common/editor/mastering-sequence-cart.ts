/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeCartMetadata, type CartMetadata, type CartMetadataInput, type CartTimer } from './cart-metadata.ts';
import type { MasteringSequenceDeliveryPlan } from './mastering-sequence-delivery.ts';
import { scaleSampleFrame } from './timeline-time.ts';

/** Radio post timers describe each occurrence in the assembled file, including its lead-in. */
export function cartForMasteringSequence(
	input: CartMetadataInput | null | undefined,
	plan: MasteringSequenceDeliveryPlan,
	projectSampleRate: number,
	outputSampleRate: number,
): CartMetadata | null {
	if (input == null) return null;
	const metadata = normalizeCartMetadata(input);
	const postTimers: CartTimer[] = [];
	for (const segment of plan.segments) {
		for (const timer of metadata.postTimers) {
			if (timer.value < segment.sourceStartFrame || timer.value > segment.sourceEndFrame) continue;
			const relativeFrame = scaleSampleFrame(timer.value - segment.sourceStartFrame,
				projectSampleRate, outputSampleRate, 'point');
			// The assembly rounds each region's length independently. A timer on
			// its exclusive source end belongs to that exact delivered end.
			const value = Math.min(segment.outputEndFrame, segment.outputStartFrame + relativeFrame);
			postTimers.push({ usage: timer.usage, value });
		}
	}
	// Retain the container's eight-timer and unsigned-32-bit limits; refusing an
	// unrepresentable delivery is preferable to truncating radio cues silently.
	return normalizeCartMetadata({ ...metadata, postTimers });
}
