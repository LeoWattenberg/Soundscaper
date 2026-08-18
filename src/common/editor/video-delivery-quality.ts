/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The quality a delivery asks for, stated as an intent rather than a knob.
 *
 * A plan says `draft`, `balanced`, or `high`; it never says `crf 23`. That is
 * the milestone's rule that the plan is the semantic authority, and it is not
 * decoration: a plan that carried encoder settings would only mean anything to
 * the encoder it was written against, so the same delivery could not be
 * replayed on another tier — and 6B-3's WebCodecs path and 6B-4's platform
 * encoders are exactly that other tier. A tier is replayable; a CRF is not.
 *
 * `balanced` is what every export produced before quality was an option, down
 * to the argument order, so an untouched delivery stays byte-stable.
 */

export const VIDEO_DELIVERY_QUALITY_TIERS = Object.freeze(['draft', 'balanced', 'high'] as const);

export type VideoDeliveryQuality = typeof VIDEO_DELIVERY_QUALITY_TIERS[number];

export const DEFAULT_VIDEO_DELIVERY_QUALITY: VideoDeliveryQuality = 'balanced';

const TIERS: ReadonlySet<string> = new Set(VIDEO_DELIVERY_QUALITY_TIERS);

export function isVideoDeliveryQuality(value: unknown): value is VideoDeliveryQuality {
	return typeof value === 'string' && TIERS.has(value);
}

/** What one tier means to an FFmpeg encoder, per delivery format. */
export interface VideoDeliveryFfmpegQuality {
	/** Constant-quality target; lower is better, and the scales differ per codec. */
	readonly crf: number;
	/** x264 speed/compression trade-off. Absent for VP9, which spells it differently. */
	readonly preset?: string;
	/** libvpx effort budget. Absent for x264. */
	readonly deadline?: string;
	readonly cpuUsed?: number;
	readonly audioBitRateKbps: number;
}

/**
 * The FFmpeg reading of each tier.
 *
 * Both shipped delivery paths — the composed graph and the keyframed encoder —
 * are FFmpeg-backed and had drifted into two hard-coded copies of the same
 * numbers, so the mapping lives here once and both read it. A path that is not
 * FFmpeg adds its own reading of the same tiers rather than a fourth tier.
 *
 * The audio rate moves with the tier because a delivery that asks for less
 * video weight and keeps a 192 kbps track is not the smaller file it asked for.
 */
const FFMPEG_QUALITY: Readonly<Record<string, Readonly<Record<VideoDeliveryQuality, VideoDeliveryFfmpegQuality>>>> =
	Object.freeze({
		mp4: Object.freeze({
			draft: Object.freeze({ crf: 28, preset: 'veryfast', audioBitRateKbps: 128 }),
			balanced: Object.freeze({ crf: 23, preset: 'medium', audioBitRateKbps: 192 }),
			high: Object.freeze({ crf: 18, preset: 'slow', audioBitRateKbps: 256 }),
		}),
		webm: Object.freeze({
			draft: Object.freeze({ crf: 36, deadline: 'good', cpuUsed: 6, audioBitRateKbps: 96 }),
			balanced: Object.freeze({ crf: 31, deadline: 'good', cpuUsed: 4, audioBitRateKbps: 160 }),
			high: Object.freeze({ crf: 24, deadline: 'good', cpuUsed: 2, audioBitRateKbps: 192 }),
		}),
	});

export function resolveVideoDeliveryFfmpegQuality(
	formatId: string,
	quality: unknown = DEFAULT_VIDEO_DELIVERY_QUALITY,
): VideoDeliveryFfmpegQuality {
	const tiers = Object.hasOwn(FFMPEG_QUALITY, formatId) ? FFMPEG_QUALITY[formatId] : undefined;
	if (!tiers) throw new RangeError(`No delivery quality mapping for format: ${String(formatId)}.`);
	if (!isVideoDeliveryQuality(quality)) {
		throw new RangeError(`Unsupported video delivery quality: ${String(quality)}.`);
	}
	return tiers[quality];
}

/** Admit a stated quality, defaulting to the tier every prior delivery used. */
export function normalizeVideoDeliveryQuality(value: unknown, name: string): VideoDeliveryQuality {
	const quality = value ?? DEFAULT_VIDEO_DELIVERY_QUALITY;
	if (!isVideoDeliveryQuality(quality)) {
		throw new RangeError(`${name} must be one of ${VIDEO_DELIVERY_QUALITY_TIERS.join(', ')}.`);
	}
	return quality;
}
