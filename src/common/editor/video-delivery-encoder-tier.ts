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
 * Browser delivery has no hidden encoder fallback. Every "no" is therefore an
 * explicit refusal: the production browser graph does not contain FFmpeg, and
 * silently changing execution backends would make the delivery report false.
 */

import { getVideoExportFormat } from './video-export.js';
import {
	resolveVideoDeliveryFfmpegQuality,
	resolveVideoDeliveryWebCodecsBitrate,
} from './video-delivery-quality.ts';
import {
	resolveVideoWebCodecsSupport,
	type VideoWebCodecsCanvas,
} from './video-webcodecs-capability.ts';
import { browserWebCodecsAudioConfiguration } from './browser-webcodecs-audio-profile.ts';

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
	/** The plan's canvas, whatever shape it is: an unreadable one is refused. */
	readonly canvas: unknown;
	readonly quality: unknown;
	/** Exact staged-audio geometry when the delivery carries an audio track. */
	readonly audio?: Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
	}>;
	/**
	 * Whether this delivery's path can consume an encoded stream at all. Only
	 * the keyed path renders RGBA frames a `VideoEncoder` could be handed; the
	 * composed-graph path asks FFmpeg to build the picture from its inputs.
	 */
	readonly eligible: boolean;
}

interface AudioEncoderProbe {
	isConfigSupported?(config: Readonly<Record<string, unknown>>): Promise<Readonly<{
		supported?: boolean;
	}>>;
}

const FFMPEG_ONLY: VideoDeliveryEncoderDecision = Object.freeze({
	tier: 'ffmpeg' as const,
	codec: null,
	bitrate: null,
	reason: null,
});

export class BrowserVideoEncoderUnavailableError extends Error {
	readonly code = 'BROWSER_VIDEO_ENCODER_UNAVAILABLE';

	constructor(reason: string) {
		super(`Browser-native video export is unavailable: ${reason}`);
		this.name = 'BrowserVideoEncoderUnavailableError';
	}
}

/** Decide the encoder for one delivery, with the reason when it is not the browser's. */
export async function resolveVideoDeliveryEncoderTier(
	request: VideoDeliveryEncoderTierRequest,
	encoder: unknown = (globalThis as Record<string, unknown>).VideoEncoder,
	audioEncoder: unknown = (globalThis as Record<string, unknown>).AudioEncoder,
): Promise<VideoDeliveryEncoderDecision> {
	if (!request.eligible) {
		throw unavailable('only a keyed frame delivery can use the browser-native encoder and muxer.');
	}
	if (typeof (globalThis as Record<string, unknown>).VideoFrame !== 'function') {
		throw unavailable('this browser has no WebCodecs video frame.');
	}
	try {
		const descriptor = getVideoExportFormat(String(request.format)) as Readonly<{
			id: 'mp4' | 'webm';
			videoCodec: string;
		}>;
		const canvas = request.canvas as VideoWebCodecsCanvas;
		const support = await resolveVideoWebCodecsSupport(
			descriptor.videoCodec,
			canvas,
			encoder as never,
		);
		if (support.tier !== 'webcodecs' || !support.codec) {
			throw unavailable(support.reason ?? 'This browser does not encode this delivery.');
		}
		if (request.audio !== undefined) {
			await assertAudioEncoderSupport(
				descriptor.id, request.quality, request.audio, audioEncoder as AudioEncoderProbe | undefined,
			);
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
		if (error instanceof BrowserVideoEncoderUnavailableError) throw error;
		throw unavailable(`this delivery could not be described to a WebCodecs encoder: ${errorText(error)}`);
	}
}

async function assertAudioEncoderSupport(
	format: 'mp4' | 'webm',
	quality: unknown,
	audio: NonNullable<VideoDeliveryEncoderTierRequest['audio']>,
	encoder: AudioEncoderProbe | undefined,
): Promise<void> {
	const label = format === 'mp4' ? 'AAC' : 'Opus';
	if (typeof (globalThis as Readonly<Record<string, unknown>>).AudioData !== 'function'
		|| typeof encoder?.isConfigSupported !== 'function') {
		throw unavailable(`this browser has no WebCodecs ${label} audio encoder.`);
	}
	const sampleRate = positiveInteger(audio.sampleRate, 'audio sample rate');
	const numberOfChannels = positiveInteger(audio.channelCount, 'audio channel count');
	const bitrate = resolveVideoDeliveryFfmpegQuality(format, quality).audioBitRateKbps * 1_000;
	let supported = false;
	try {
		supported = (await encoder.isConfigSupported(browserWebCodecsAudioConfiguration(
			format === 'mp4' ? 'aac' : 'opus',
			{ sampleRate, channelCount: numberOfChannels, bitrate },
		))).supported === true;
	} catch {
		throw unavailable(`the WebCodecs ${label} audio capability probe was refused.`);
	}
	if (!supported) throw unavailable(`this browser does not encode ${label} audio for the delivery.`);
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`Browser-native video ${label} must be a positive integer.`);
	}
	return value;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The decision a delivery carries when nothing was chosen against it. */
export const VIDEO_DELIVERY_FFMPEG_ENCODER: VideoDeliveryEncoderDecision = FFMPEG_ONLY;

function unavailable(reason: string): BrowserVideoEncoderUnavailableError {
	return new BrowserVideoEncoderUnavailableError(reason);
}
