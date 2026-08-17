/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	MasteringSequenceDeliveryPlan,
	MasteringSequenceDeliverySegment,
} from './mastering-sequence-delivery.ts';

/**
 * Assembling the delivered audio a mastering sequence describes.
 *
 * Each entry is rendered by the ordinary offline render over its own region
 * range — the same render playback and every other export uses — and this places
 * those buffers into the delivered timeline, applies the authored fades, and
 * leaves the gaps as actual silence. There is no second renderer here: this
 * takes finished PCM and arranges it.
 *
 * **Fades are shaped in the delivered domain, not baked into the project.** A
 * fade is a property of the delivery, so it is applied to the copy on its way
 * out and the region it came from is untouched — which is what lets the same
 * region appear twice in one sequence with different fades.
 */

export interface MasteringSequenceRenderedSegment {
	readonly entryId: string;
	/** The rendered audio for this entry's region, one array per channel. */
	readonly channels: readonly Float32Array[];
}

export interface MasteringSequenceRenderRequest {
	readonly plan: MasteringSequenceDeliveryPlan;
	readonly segments: readonly MasteringSequenceRenderedSegment[];
	readonly channelCount: number;
}

/** Build the delivered channels: gaps as silence, regions in order, fades applied. */
export function renderMasteringSequenceDelivery(
	request: MasteringSequenceRenderRequest,
): readonly Float32Array[] {
	const { plan, channelCount } = request;
	if (!Number.isSafeInteger(channelCount) || channelCount <= 0) {
		throw new RangeError('A mastering sequence delivery requires a positive channel count.');
	}
	const rendered = new Map(request.segments.map((segment) => [segment.entryId, segment.channels]));
	const output = Array.from({ length: channelCount }, () => new Float32Array(plan.totalFrames));

	for (const segment of plan.segments) {
		const channels = rendered.get(segment.entryId);
		if (!channels) {
			throw new ReferenceError(`Mastering sequence entry ${segment.entryId} was not rendered.`);
		}
		const expected = segment.outputEndFrame - segment.outputStartFrame;
		for (const channel of channels) {
			if (channel.length === expected) continue;
			// A short or long segment would slide every later entry, so the
			// mismatch is refused rather than padded into place.
			throw new RangeError(
				`Mastering sequence entry ${segment.entryId} rendered ${channel.length} frames, not ${expected}.`,
			);
		}
		for (let index = 0; index < channelCount; index += 1) {
			// Fewer rendered channels than the delivery carries means the render and
			// the plan disagree; taking the last one would invent a channel map.
			const source = channels[index];
			if (!source) throw new RangeError(`Mastering sequence entry ${segment.entryId} is missing a channel.`);
			writeSegment(output[index], source, segment);
		}
	}
	return Object.freeze(output);
}

function writeSegment(
	target: Float32Array,
	source: Float32Array,
	segment: MasteringSequenceDeliverySegment,
): void {
	const length = source.length;
	const fadeIn = Math.min(segment.fadeInFrames, length);
	const fadeOut = Math.min(segment.fadeOutFrames, length);
	for (let frame = 0; frame < length; frame += 1) {
		target[segment.outputStartFrame + frame] = source[frame] * fadeGain(frame, length, fadeIn, fadeOut);
	}
}

/**
 * Linear fades, and the shortest possible one still reaches silence.
 *
 * The gain is taken across `fade` steps rather than `fade - 1`, so a one-frame
 * fade-in starts at zero and the first audible sample is the second one. The
 * alternative makes a one-frame fade a no-op, which is a fade the operator
 * authored and cannot hear.
 */
function fadeGain(frame: number, length: number, fadeIn: number, fadeOut: number): number {
	let gain = 1;
	if (fadeIn > 0 && frame < fadeIn) gain = frame / fadeIn;
	if (fadeOut > 0) {
		const remaining = length - 1 - frame;
		if (remaining < fadeOut) gain = Math.min(gain, remaining / fadeOut);
	}
	return gain;
}
