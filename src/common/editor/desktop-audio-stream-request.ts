/* SPDX-License-Identifier: AGPL-3.0-only */
import { DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES, DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT, type DesktopAudioCodecFormat } from '../../../desktop/desktop-audio-codec-operation-contract.ts';
import type { DesktopAudioCodecCapabilityTuple } from '../../../desktop/desktop-audio-codec-capability-contract.ts';
import { applyMediaChannelMapping, createMediaExportCapabilities, normalizeMediaExportSettings, mp3CodecRateSettings, opusCodecRateSettings } from './media-export.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from './wav-import.js';
import { writeInterleavedFloat32Pcm } from './interleaved-float32-pcm.ts';
import type { WavPcmDescriptor } from './wav-pcm-chunk-reader.ts';
import type { DesktopAudioCodecRuntimeSettings, NormalizedMediaSettings } from './desktop-audio-codec-runtime.ts';
import type { DesktopAudioStreamEncoderRequest } from './desktop-audio-stream-encoder.ts';
const capabilities = createMediaExportCapabilities();

export async function buildDesktopAudioStreamRequest(file: Blob, format: DesktopAudioCodecFormat,
	settings: DesktopAudioCodecRuntimeSettings): Promise<DesktopAudioStreamEncoderRequest | null> {
	const descriptor = await inspectWavBlobPcm(file, { signal: settings.signal }) as WavPcmDescriptor;
	const media = normalizeMediaExportSettings(format, { ...settings, capabilities,
		inputChannelCount: descriptor.channelCount, sampleRate: settings.sampleRate ?? descriptor.sampleRate }) as NormalizedMediaSettings;
	if (descriptor.frameCount * media.channelCount * 4 <= DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES) return null;
	if (media.sampleRate !== descriptor.sampleRate || (settings.inputChannelCount !== undefined && settings.inputChannelCount !== descriptor.channelCount)) {
		throw new RangeError('The staged WAV geometry must match its desktop streaming export settings.');
	}
	return { file, plan: { schemaVersion: 1, frameCount: descriptor.frameCount,
		tuple: { operation: 'audio-encode', format, sampleRate: media.sampleRate, channelCount: media.channelCount,
			settings: encodeDesktopAudioSettings(format, media) as DesktopAudioCodecCapabilityTuple['settings'] },
		maximumOutputBytes: settings.maximumOutputBytes ?? 1_000_000_000 }, channelMapping: media.channelMapping,
		extension: `.${media.extension}`, mimeType: media.mimeType, settings };
}

export function encodeDesktopAudioSettings(format: DesktopAudioCodecFormat, media: NormalizedMediaSettings,
): Readonly<Record<string, number>> {
	if (format === 'flac') {
		return Object.freeze({
			compressionLevel: requiredInteger(media.compressionLevel, 'flac compression level'),
			bitDepth: requiredInteger(media.bitDepth, 'flac bit depth'),
		});
	}
	if (format === 'wavpack') {
		return Object.freeze({ compressionLevel: requiredInteger(media.compressionLevel, `${format} compression level`) });
	}
	if (format === 'ogg-vorbis') {
		return Object.freeze({ quality: requiredInteger(media.quality, 'Vorbis quality') });
	}
	if (format === 'mp3') return mp3CodecRateSettings(media);
	if (format === 'opus') return opusCodecRateSettings(media);
	return Object.freeze({ bitrateKbps: requiredInteger(media.bitRate, `${format} bitrate`) });
}

function requiredInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value)) throw new TypeError(`Invalid ${label}.`);
	return Number(value);
}

export async function stagedDesktopWavPcm(file: Blob, format: DesktopAudioCodecFormat,
	settings: DesktopAudioCodecRuntimeSettings, unsupported: (message: string) => Error,
): Promise<Readonly<{ readonly input: Uint8Array; readonly media: NormalizedMediaSettings }>> {
	if (!(file instanceof Blob)) throw new TypeError('Expected a staged WAV Blob.');
	const signal = settings.signal;
	const descriptor = await inspectWavBlobPcm(file, signal ? { signal } : {}) as WavPcmDescriptor;
	if (settings.inputChannelCount !== undefined && settings.inputChannelCount !== descriptor.channelCount) {
		throw new RangeError('The staged WAV channel count does not match the export settings.');
	}
	const media = normalizeMediaExportSettings(format, {
		...settings,
		capabilities,
		inputChannelCount: descriptor.channelCount,
		sampleRate: settings.sampleRate ?? descriptor.sampleRate,
	}) as NormalizedMediaSettings;
	// The closed broker has no metadata field; desktop compressed metadata is intentionally dropped.
	if (media.sampleRate !== descriptor.sampleRate) {
		throw unsupported(
			'The desktop audio bridge cannot resample a staged WAV before encoding.',
		);
	}
	if (media.channelCount > DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT
		|| ((format === 'mp3' || format === 'mp2') && media.channelCount > 2)) {
		throw unsupported(
			`${format === 'mp3' || format === 'mp2' ? format.toUpperCase() : 'The desktop audio bridge'} supports at most ${format === 'mp3' || format === 'mp2' ? '2' : String(DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT)} output channels.`,
		);
	}
	const byteLength = descriptor.frameCount * media.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(byteLength) || byteLength < 1
		|| byteLength > DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES) {
		throw unsupported(
			`The staged WAV requires ${String(byteLength)} interleaved PCM bytes; the desktop audio bridge limit is ${String(DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES)}.`,
		);
	}
	const input = new Uint8Array(byteLength);
	await streamWavBlobPcm(file, {
		descriptor,
		signal,
		onChunk(packet: readonly Float32Array[], details: Readonly<{ frameOffset: number }>) {
			const channels = applyMediaChannelMapping(packet, media.channelMapping as string) as readonly Float32Array[];
			if (channels.length !== media.channelCount) {
				throw new Error('The staged WAV channel mapping returned unexpected geometry.');
			}
			writeInterleavedFloat32Pcm(input, channels, {
				destinationFrameOffset: details.frameOffset, nonFinite: 'zero',
			});
		},
	});
	return Object.freeze({ input, media });
}
