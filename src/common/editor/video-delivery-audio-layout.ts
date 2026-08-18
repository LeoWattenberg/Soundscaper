/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The channel layout a video delivery asks its audio track for.
 *
 * These are the shared channel-mapping names the audio exporter already uses,
 * narrowed to the three a video delivery can state. A custom matrix stays with
 * the audio path: it needs the per-channel editor to mean anything, and a
 * delivery preset that carried one would resolve into a video plan with no
 * surface able to show what it was asking for.
 *
 * The layout is applied to the rendered mix before it is staged as WAV, not to
 * the encoder afterwards. That is what makes the composed-graph path and the
 * keyed path deliver the same audio: both consume the staged mix, so a downmix
 * that happened in an encoder argument would only reach one of them.
 */

export const VIDEO_DELIVERY_AUDIO_LAYOUTS = Object.freeze(['preserve', 'mono', 'stereo'] as const);

export type VideoDeliveryAudioLayout = typeof VIDEO_DELIVERY_AUDIO_LAYOUTS[number];

export const DEFAULT_VIDEO_DELIVERY_AUDIO_LAYOUT: VideoDeliveryAudioLayout = 'preserve';

const LAYOUTS: ReadonlySet<string> = new Set(VIDEO_DELIVERY_AUDIO_LAYOUTS);

export function isVideoDeliveryAudioLayout(value: unknown): value is VideoDeliveryAudioLayout {
	return typeof value === 'string' && LAYOUTS.has(value);
}

/** Admit a stated layout, defaulting to the project's own channels. */
export function normalizeVideoDeliveryAudioLayout(
	value: unknown,
	name: string,
): VideoDeliveryAudioLayout {
	const layout = value ?? DEFAULT_VIDEO_DELIVERY_AUDIO_LAYOUT;
	if (!isVideoDeliveryAudioLayout(layout)) {
		throw new RangeError(`${name} must be one of ${VIDEO_DELIVERY_AUDIO_LAYOUTS.join(', ')}.`);
	}
	return layout;
}
