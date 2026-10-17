/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAsset } from './motion-asset.ts';
import { normalizeRational, type Rational } from './timeline-time.ts';
import { classifyImageFormatSignature } from './image-format-signature.ts';
import { encodedImageIsAnimated } from './image-animation-topology.ts';
import { motionSurfaceLength } from './motion-surface.ts';
import { normalizeMotionAudioFormat } from './motion-audio-contract.ts';

type ImageMetadata = Pick<Extract<MotionAsset, { kind: 'image' }>, 'kind' | 'mimeType' | 'width' | 'height' | 'hasAlpha'>;
type VideoMetadata = Pick<Extract<MotionAsset, { kind: 'footage' }>, 'kind' | 'mimeType' | 'width' | 'height' | 'hasAlpha' | 'frameRate' | 'duration' | 'hasAudio'>;
type AudioMetadata = Pick<Extract<MotionAsset, { kind: 'audio' }>, 'kind' | 'mimeType' | 'sampleRate' | 'channels' | 'duration'>;
export type MotionMediaMetadata = ImageMetadata | VideoMetadata | AudioMetadata;

/** Preserve the demuxer's integer tick grid rather than treating nominal FPS as source timing. */
export function motionMediaTime(seconds: number, resolution: number): Rational {
	const ticks = Math.round(seconds * resolution);
	if (!Number.isSafeInteger(resolution) || resolution < 1 || !Number.isSafeInteger(ticks) || ticks < 1 || Math.abs(ticks - seconds * resolution) > 0.001) throw new RangeError('Media time cannot be represented on its declared source tick grid.');
	return normalizeRational({ num: ticks, den: resolution });
}
function nominalFrameRate(value: number): Rational {
	for (const num of [24000, 30000, 60000, 120000]) if (Math.abs(value - num / 1001) < 1e-6) return normalizeRational({ num, den: 1001 });
	return normalizeRational({ num: Math.round(value * 1000000), den: 1000000 });
}

export async function probeMotionMedia(bytes: Uint8Array, signal?: AbortSignal): Promise<MotionMediaMetadata> {
	signal?.throwIfAborted();
	const image = classifyImageFormatSignature(bytes);
	if (image.status === 'recognized') {
		if (!['png', 'jpeg', 'webp', 'gif'].includes(image.format)) throw new Error('Motion image import currently accepts PNG, JPEG, WebP and GIF.');
		if (encodedImageIsAnimated(bytes, image.format)) throw new Error('Animated images require a footage decoder; import a video file for this animation.');
		const { loadMotionRasterRuntime } = await import('./controller/composition/motion-raster-runtime.ts');
		const { kit } = await loadMotionRasterRuntime(signal);
		const decoded = kit.MakeImageFromEncoded(bytes);
		if (!decoded) throw new Error('The image could not be decoded.');
		try {
			const width = decoded.width(); const height = decoded.height(); motionSurfaceLength(width, height);
			const alpha = decoded.getImageInfo().alphaType;
			return { kind: 'image', width, height, hasAlpha: alpha !== kit.AlphaType.Opaque, mimeType: `image/${image.format}` };
		} finally { decoded.delete(); }
	}
	const { Input, BufferSource, ALL_FORMATS, HLS } = await import('mediabunny');
	const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS.filter((format) => format !== HLS) });
	const abort = () => input.dispose(); signal?.addEventListener('abort', abort, { once: true });
	try {
		const video = await input.getPrimaryVideoTrack(); const audio = await input.getPrimaryAudioTrack();
		signal?.throwIfAborted();
		if (!video && !audio) throw new Error('The media contains no supported audio or video track.');
		const mimeType = (await input.getFormat()).mimeType;
		if (audio) {
			normalizeMotionAudioFormat({ sampleRate: await audio.getSampleRate(), channels: await audio.getNumberOfChannels(), sampleCount: 0 });
			if (!await audio.canDecode()) throw new Error('The audio codec is unavailable in this browser.');
		}
		if (video) {
			if (await video.hasHighDynamicRange()) throw new Error('Motion compositions currently accept SDR footage. Convert HDR footage to SDR before importing it.');
			if (!await video.canDecode()) throw new Error('The video codec is unavailable in this browser.');
			const width = await video.getDisplayWidth(); const height = await video.getDisplayHeight(); motionSurfaceLength(width, height);
			const duration = motionMediaTime(await video.computeDuration(), await video.getTimeResolution());
			const metrics = await video.computeFrameRateMetrics({ targetPacketCount: 256 });
			signal?.throwIfAborted();
			return { kind: 'footage', mimeType, width, height, duration, frameRate: nominalFrameRate(metrics.bestGuessFrameRate), hasAudio: audio !== null, hasAlpha: await video.canBeTransparent() };
		}
		const duration = motionMediaTime(await audio!.computeDuration(), await audio!.getTimeResolution());
		return { kind: 'audio', mimeType, duration, sampleRate: await audio!.getSampleRate(), channels: await audio!.getNumberOfChannels() };
	} catch (error) { signal?.throwIfAborted(); throw error; }
	finally { signal?.removeEventListener('abort', abort); input.dispose(); }
}
