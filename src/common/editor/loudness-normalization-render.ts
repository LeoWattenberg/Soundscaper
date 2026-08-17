/* SPDX-License-Identifier: AGPL-3.0-only */

import { measureBextLoudness } from './broadcast-loudness.ts';
import {
	type LoudnessNormalizationDecision,
	type LoudnessNormalizationTarget,
	computeLoudnessNormalization,
	loudnessNormalizationChangesAudio,
	loudnessNormalizationGainFactor,
} from './loudness-normalization.ts';

/**
 * Applying the loudness decision to a finished render.
 *
 * This is the other half of `loudness-normalization.ts`: that module decides one
 * gain from a measurement, this one measures, applies it, and measures again.
 * Keeping them apart is what lets the decision be inspected, reported, and
 * tested without a renderer, and it is why no encoder ever receives a loudness
 * flag — by the time bytes are written the gain is already in the samples.
 *
 * **The second measurement is the point, not a formality.** A delivery that
 * captures loudness metadata must describe the bytes it actually wrote, so the
 * numbers stamped into the file come from measuring the normalized channels
 * rather than from the projection the decision made. The two agree to within
 * the meter's gating behaviour, and where they do not, the delivered value is
 * the true one.
 *
 * **The gain is applied in place.** The channels belong to this delivery's own
 * render, are consumed once, and are discarded afterwards; copying them would
 * double peak memory at exactly the size where a delivery is already tight — a
 * one-hour stereo master is well over a gigabyte of float samples before any
 * copy. The structural guard that makes this safe is that a normalized delivery
 * refuses the realtime re-encode fallback, so the buffer is never encoded twice.
 */

export type RenderedLoudnessMeasurement = ReturnType<typeof measureBextLoudness>;

export interface NormalizeRenderedLoudnessRequest {
	readonly channels: readonly Float32Array[];
	readonly sampleRate: number;
	/** The plan's target. Null means measure only, or do nothing at all. */
	readonly target?: LoudnessNormalizationTarget | null;
	/** Whether anything downstream stamps loudness into the delivery, such as a BEXT chunk. */
	readonly captureLoudness?: boolean;
}

export interface NormalizedRenderedLoudness {
	/** The channels to encode. The same arrays as the request; gain is applied in place. */
	readonly channels: readonly Float32Array[];
	/** Null only when nothing asked for either normalization or measurement. */
	readonly decision: LoudnessNormalizationDecision | null;
	/** Measured from the written channels, after any gain. Null when nothing captures it. */
	readonly delivered: RenderedLoudnessMeasurement | null;
}

export function normalizeRenderedLoudness(
	request: NormalizeRenderedLoudnessRequest,
): NormalizedRenderedLoudness {
	const { channels, sampleRate } = request;
	const target = request.target ?? null;
	const captureLoudness = request.captureLoudness === true;

	// Measuring an hour of audio is not free, so it happens only when a target
	// needs deciding or a capture needs filling.
	if (!target && !captureLoudness) {
		return result(channels, null, null);
	}

	const measured = measureBextLoudness(channels, sampleRate);
	if (!target) {
		// A delivery without normalization still reports its measured loudness,
		// so the report says the same kind of thing either way.
		return result(channels, computeLoudnessNormalization(measured, null), measured);
	}

	const decision = computeLoudnessNormalization(measured, target);
	if (!loudnessNormalizationChangesAudio(decision)) {
		// Already on target, or unmeasurable. Nothing moved, so the first
		// measurement is also the delivered one — no second pass to pay for.
		return result(channels, decision, captureLoudness ? measured : null);
	}

	const factor = loudnessNormalizationGainFactor(decision);
	for (const channel of channels) {
		for (let index = 0; index < channel.length; index += 1) channel[index] *= factor;
	}
	return result(
		channels,
		decision,
		captureLoudness ? measureBextLoudness(channels, sampleRate) : null,
	);
}

function result(
	channels: readonly Float32Array[],
	decision: LoudnessNormalizationDecision | null,
	delivered: RenderedLoudnessMeasurement | null,
): NormalizedRenderedLoudness {
	return Object.freeze({ channels, decision, delivered });
}
