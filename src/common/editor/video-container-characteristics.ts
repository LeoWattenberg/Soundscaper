/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Source characteristics read from MP4/WebM container metadata.
 *
 * Mediabunny only demuxes here. No decoder or browser codec implementation is
 * needed to report coded geometry, presentation transforms, codec identifiers,
 * colour tags, alpha signalling, or the audio-track inventory.
 */

import type { InputAudioTrack, InputTrack } from 'mediabunny';
import { throwIfAborted } from './video-timing-demux-reader.ts';
import {
	normalizeVideoSourceCharacteristics,
	VIDEO_SOURCE_MAXIMUM_ASPECT_TERM,
	VIDEO_SOURCE_MAXIMUM_AUDIO_CHANNELS,
	VIDEO_SOURCE_MAXIMUM_AUDIO_SAMPLE_RATE,
	VIDEO_SOURCE_MAXIMUM_AUDIO_STREAMS,
	VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION,
	type VideoSourceAudioStream,
	type VideoSourceCharacteristics,
} from './video-source-characteristics.ts';

const TAG = /^[A-Za-z0-9][A-Za-z0-9 ._+/()-]*$/u;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;
const CODEC_NAMES: Readonly<Record<string, string>> = Object.freeze({
	avc: 'h264',
	hevc: 'hevc',
});

/** Read the characteristic subset a container states without decoding media. */
export async function readContainerVideoSourceCharacteristics(
	blob: Blob,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<VideoSourceCharacteristics> {
	if (!(blob instanceof Blob)) throw new TypeError('A video Blob is required for characteristics demux.');
	throwIfAborted(options.signal);
	const { BlobSource, Input, MATROSKA, MP4, QTFF, WEBM } = await import('mediabunny');
	throwIfAborted(options.signal);
	const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, MATROSKA, WEBM] });
	const onAbort = (): void => input.dispose();
	options.signal?.addEventListener('abort', onAbort, { once: true });
	try {
		const tracks = await input.getTracks();
		throwIfAborted(options.signal);
		const video = tracks.find((track) => track.isVideoTrack());
		if (!video?.isVideoTrack()) {
			return normalizeVideoSourceCharacteristics({ backend: 'container' });
		}
		const [codedWidth, codedHeight, rotation, aspect, codec, colour, hasAlpha] = await Promise.all([
			video.getCodedWidth(),
			video.getCodedHeight(),
			video.getRotation(),
			video.getPixelAspectRatio(),
			video.getCodec(),
			video.getColorSpace(),
			video.canBeTransparent(),
		]);
		const audioStreams = await readAudioStreams(
			tracks.filter((track): track is InputAudioTrack => track.isAudioTrack()),
			tracks,
		);
		throwIfAborted(options.signal);
		const reportedWidth = boundedPositiveInteger(codedWidth, VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION);
		const reportedHeight = boundedPositiveInteger(codedHeight, VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION);
		const reportsGeometry = reportedWidth !== null && reportedHeight !== null;
		return normalizeVideoSourceCharacteristics({
			backend: 'container',
			codedWidth: reportsGeometry ? reportedWidth : null,
			codedHeight: reportsGeometry ? reportedHeight : null,
			rotationDegrees: rotation === 90 || rotation === 180 || rotation === 270 ? rotation : null,
			pixelAspectRatio: boundedAspect(aspect),
			fieldOrder: null,
			hasAlpha: typeof hasAlpha === 'boolean' ? hasAlpha : null,
			videoCodec: codecName(codec),
			colour: {
				primaries: tag(colour.primaries),
				transfer: tag(colour.transfer),
				matrix: tag(colour.matrix),
				range: typeof colour.fullRange === 'boolean'
					? (colour.fullRange ? 'full' : 'limited')
					: null,
			},
			audioStreams,
			extractedAudioStreamIndex: null,
			startTimecode: null,
		});
	} catch (error) {
		throwIfAborted(options.signal);
		throw error;
	} finally {
		options.signal?.removeEventListener('abort', onAbort);
		input.dispose();
	}
}

async function readAudioStreams(
	audioTracks: readonly InputAudioTrack[],
	allTracks: readonly InputTrack[],
): Promise<readonly VideoSourceAudioStream[] | null> {
	if (audioTracks.length === 0 || audioTracks.length > VIDEO_SOURCE_MAXIMUM_AUDIO_STREAMS) return null;
	const streams = await Promise.all(audioTracks.map(async (track) => {
		const [codec, channelCount, sampleRate, language] = await Promise.all([
			track.getCodec(),
			track.getNumberOfChannels(),
			track.getSampleRate(),
			track.getLanguageCode(),
		]);
		const index = allTracks.indexOf(track);
		return Object.freeze({
			index,
			codec: codecName(codec),
			channelCount: boundedPositiveInteger(channelCount, VIDEO_SOURCE_MAXIMUM_AUDIO_CHANNELS),
			sampleRate: boundedPositiveInteger(sampleRate, VIDEO_SOURCE_MAXIMUM_AUDIO_SAMPLE_RATE),
			language: language === 'und' || !LANGUAGE.test(language) ? null : language,
		});
	}));
	if (streams.some(({ index }) => index < 0 || index > VIDEO_SOURCE_MAXIMUM_AUDIO_STREAMS)) return null;
	return Object.freeze(streams.sort((left, right) => left.index - right.index));
}

function boundedAspect(value: Readonly<{ num: number; den: number }>): Readonly<{
	readonly num: number;
	readonly den: number;
}> | null {
	const num = boundedPositiveInteger(value.num, VIDEO_SOURCE_MAXIMUM_ASPECT_TERM);
	const den = boundedPositiveInteger(value.den, VIDEO_SOURCE_MAXIMUM_ASPECT_TERM);
	return num === null || den === null ? null : Object.freeze({ num, den });
}

function boundedPositiveInteger(value: unknown, maximum: number): number | null {
	return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum
		? Number(value)
		: null;
}

function codecName(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	return tag(CODEC_NAMES[value] ?? value);
}

function tag(value: unknown): string | null {
	return typeof value === 'string' && value.length <= 64 && TAG.test(value) ? value : null;
}
