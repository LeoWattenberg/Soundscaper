/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What a video delivery does with the captions it was asked for.
 *
 * Split out of the plan builder because it is one decision with its own rules —
 * which container can carry a track, which sidecar spellings are legal, and
 * whether the named track has anything to say inside the delivered range — and
 * because the builder around it had reached the size this repository allows.
 */

import {
	isVideoCaptionSidecarFormat,
	resolveVideoCaptionCues,
	VIDEO_CAPTION_SIDECAR_FORMATS,
} from './video-caption-cues.ts';

/**
 * What this delivery does about captions, or null for the deliveries that do
 * nothing — which is every delivery that shipped before this option existed.
 *
 * A container states whether it can carry a caption track. Where it cannot,
 * asking to mux is refused rather than silently downgraded to a sidecar: the
 * caller chose a container and a delivery, and quietly changing one of them is
 * the hidden behaviour this milestone exists to remove. The report says so for
 * the caller who did not choose.
 *
 * The muxed document is always SubRip. It is the interchange both subtitle
 * encoders read losslessly for plain cues, so the muxed track does not vary
 * with the sidecar the caller happened to pick.
 */
export function resolveVideoCaptionDelivery(runtimeProject, format, range, requested) {
	if (requested == null) return null;
	if (typeof requested !== 'object' || Array.isArray(requested)) {
		throw new TypeError('captions must be an object stating a track and a delivery.');
	}
	for (const key of Object.keys(requested)) {
		if (!['trackId', 'mux', 'sidecar', 'burnIn'].includes(key)) {
			throw new RangeError(`Unsupported captions option: ${key}.`);
		}
	}
	const mux = requested.mux ?? true;
	if (typeof mux !== 'boolean') throw new TypeError('captions.mux must be boolean.');
	const burnIn = requested.burnIn ?? false;
	if (typeof burnIn !== 'boolean') throw new TypeError('captions.burnIn must be boolean.');
	const sidecar = requested.sidecar ?? null;
	if (sidecar !== null && !isVideoCaptionSidecarFormat(sidecar)) {
		throw new RangeError(`captions.sidecar must be null or one of ${VIDEO_CAPTION_SIDECAR_FORMATS.join(', ')}.`);
	}
	if (!mux && !burnIn && sidecar === null) {
		throw new RangeError('captions must be burned in, muxed, delivered as a sidecar, or some combination.');
	}
	if (mux && !format.subtitleCodec) {
		throw new RangeError(`The ${format.id} container cannot carry a caption track; deliver a sidecar instead.`);
	}
	const cues = resolveVideoCaptionCues(runtimeProject, {
		trackId: requested.trackId,
		startFrame: range.startFrame,
		endFrame: range.endFrame,
	});
	// Nothing to deliver is a refusal here rather than a delivery that quietly
	// carries none. A muxed document with no cues is a zero-byte file the shipped
	// FFmpeg refuses to open, so the delivery used to die in the encoder with a
	// message that never mentioned captions; a sidecar would be an empty file and
	// a burn-in a silent no-op. Which track is empty, and for which range, is
	// what the operator needs to hear.
	if (cues.length === 0) {
		throw new RangeError(
			`Track ${String(requested.trackId)} contributes no captions to the delivered range.`,
		);
	}
	return Object.freeze({
		trackId: requested.trackId,
		cueCount: cues.length,
		mux,
		burnIn,
		subtitleCodec: mux ? format.subtitleCodec : null,
		sidecarFormat: sidecar,
	});
}
