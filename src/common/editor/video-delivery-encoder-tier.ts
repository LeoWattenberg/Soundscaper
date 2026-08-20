/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Choosing which encoder produces a delivery, once, where it can be reported.
 *
 * The decision is made before anything is encoded and travels down to the
 * encoder that runs, rather than being taken deep inside one. That ordering is
 * the point: the delivery report is written from the plan before the encode
 * begins, so a decision made later could not appear in it, and a delivery that
 * quietly took the slower path with no explanation is exactly the reporting
 * failure this milestone's gate exists to catch.
 *
 * Every "no" therefore carries its reason, including the ones that have nothing
 * to do with the browser: a composed-graph delivery has no place to put encoded
 * chunks, because FFmpeg is compositing the picture itself, and saying so is
 * more useful than reporting a capability the browser may well have.
 */

import { getVideoExportFormat } from './video-export.js';
import { resolveVideoDeliveryWebCodecsBitrate } from './video-delivery-quality.ts';
import {
	resolveVideoWebCodecsSupport,
	type VideoWebCodecsCanvas,
} from './video-webcodecs-capability.ts';

export interface VideoDeliveryEncoderDecision {
	readonly tier: 'webcodecs' | 'ffmpeg';
	readonly codec: string | null;
	readonly bitrate: number | null;
	/** Why the browser's encoder was not chosen, or null when it was. */
	readonly reason: string | null;
}

export interface VideoDeliveryEncoderTierRequest {
	/** `mp4` or `webm`, as the plan states it. */
	readonly format: string;
	/** The plan's canvas, whatever shape it is: an unreadable one is a fallback. */
	readonly canvas: unknown;
	readonly quality: unknown;
	/**
	 * Whether this delivery's path can consume an encoded stream at all. Only
	 * the keyed path renders RGBA frames a `VideoEncoder` could be handed; the
	 * composed-graph path asks FFmpeg to build the picture from its inputs.
	 */
	readonly eligible: boolean;
}

const FFMPEG_ONLY: VideoDeliveryEncoderDecision = Object.freeze({
	tier: 'ffmpeg' as const,
	codec: null,
	bitrate: null,
	reason: null,
});

/** Decide the encoder for one delivery, with the reason when it is not the browser's. */
export async function resolveVideoDeliveryEncoderTier(
	request: VideoDeliveryEncoderTierRequest,
	encoder: unknown = (globalThis as Record<string, unknown>).VideoEncoder,
): Promise<VideoDeliveryEncoderDecision> {
	if (!request.eligible) {
		return fallback('This delivery is composed by FFmpeg’s own filter graph.');
	}
	if ((globalThis as Record<string, unknown>).crossOriginIsolated !== true
		|| typeof (globalThis as Record<string, unknown>).SharedArrayBuffer !== 'function') {
		return fallback('This page is not cross-origin isolated for WebCodecs video delivery.');
	}
	if (typeof (globalThis as Record<string, unknown>).VideoFrame !== 'function') {
		return fallback('This browser has no WebCodecs video frame.');
	}
	// Nothing about asking this question may fail a delivery: a plan the probe
	// cannot describe — an unstated rate, a canvas of another shape — falls back
	// to the encoder that was going to run anyway, and says why.
	try {
		const descriptor = getVideoExportFormat(String(request.format)) as Readonly<{ videoCodec: string }>;
		const canvas = request.canvas as VideoWebCodecsCanvas;
		const support = await resolveVideoWebCodecsSupport(
			descriptor.videoCodec,
			canvas,
			encoder as never,
		);
		if (support.tier !== 'webcodecs' || !support.codec) {
			return fallback(support.reason ?? 'This browser does not encode this delivery.');
		}
		return Object.freeze({
			tier: 'webcodecs' as const,
			codec: support.codec,
			bitrate: resolveVideoDeliveryWebCodecsBitrate(
				descriptor.videoCodec, request.quality, canvas,
			),
			reason: null,
		});
	} catch (error) {
		return fallback(`This delivery could not be described to a WebCodecs encoder: ${errorText(error)}`);
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The decision a delivery carries when nothing was chosen against it. */
export const VIDEO_DELIVERY_FFMPEG_ENCODER: VideoDeliveryEncoderDecision = FFMPEG_ONLY;

function fallback(reason: string): VideoDeliveryEncoderDecision {
	return Object.freeze({ tier: 'ffmpeg' as const, codec: null, bitrate: null, reason });
}
