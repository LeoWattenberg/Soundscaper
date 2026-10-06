/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeDesktopAudioStreamPlan } from '../../../desktop/desktop-audio-stream-contract.ts';
import type { DesktopAudioCodecFormat } from '../../../desktop/desktop-audio-codec-operation-contract.ts';
import type { DesktopAudioCodecCapabilityTuple } from '../../../desktop/desktop-audio-codec-capability-contract.ts';
import { createMediaExportCapabilities, normalizeMediaExportSettings } from './media-export.js';
import { encodeDesktopAudioSettings } from './desktop-audio-stream-request.ts';
import { queryDesktopAudioCodecCapability } from './desktop-audio-codec-capabilities.ts';
import type { DesktopAudioCodecRuntimeSettings, NormalizedMediaSettings } from './desktop-audio-codec-runtime.ts';
import { encodeDesktopAudioStreamFile, encodeDesktopAudioStreamToSink, withDesktopAudioStreamOwnership,
	type DesktopAudioStreamCommandBridge, type DesktopAudioStreamFileResult } from './desktop-audio-stream-encoder.ts';
import { assertFfmpegOutputReady, type FfmpegOutputSink } from './ffmpeg-output-stream.ts';
import type { DesktopPcmStreamProducer } from './desktop-audio-pcm-stream-write.ts';
export { writeDesktopPcmStream, type DesktopPcmStreamProducer, type DesktopPcmStreamWrite } from './desktop-audio-pcm-stream-write.ts';
import { LARGE_AUDIO_FILE_BYTES } from './large-audio-policy.ts';

export interface DesktopPcmStreamGeometry {
	readonly frameCount: number; readonly channelCount: number; readonly sampleRate: number;
}
export interface PreparedDesktopPcmStream {
	encode(producePcm: DesktopPcmStreamProducer): Promise<DesktopAudioStreamFileResult>;
	encodeToSink<Output>(producePcm: DesktopPcmStreamProducer, sink: FfmpegOutputSink<Output>):
		Promise<Readonly<{ output: Output; byteLength: number; chunkCount: number; extension: string; mimeType: string }>>;
}
interface PreparationPorts {
	readonly bridge: DesktopAudioStreamCommandBridge;
	readonly queryCapability: Parameters<typeof queryDesktopAudioCodecCapability>[0];
	readonly active: Map<string, { cancel(reason: unknown): void }>;
	readonly mintRequestId: () => string; readonly assertActive: () => void;
}

/** Admit the same final float geometry and closed codec tuple used by WAV staging. */
export async function prepareDesktopPcmStream(geometry: DesktopPcmStreamGeometry, format: DesktopAudioCodecFormat,
	settings: DesktopAudioCodecRuntimeSettings, ports: PreparationPorts,
): Promise<PreparedDesktopPcmStream | null> {
	assertFfmpegOutputReady(settings); ports.assertActive();
	if (format === 'flac' || format === 'aac-m4a') return null;
	if (!Number.isSafeInteger(geometry.frameCount) || geometry.frameCount < 1
		|| !Number.isSafeInteger(geometry.channelCount) || geometry.channelCount < 1
		|| !Number.isSafeInteger(geometry.sampleRate) || geometry.sampleRate < 1) {
		throw new RangeError('Desktop PCM stream geometry is invalid.');
	}
	const media = normalizeMediaExportSettings(format, { ...settings, capabilities: createMediaExportCapabilities(),
		inputChannelCount: geometry.channelCount, sampleRate: settings.sampleRate ?? geometry.sampleRate }) as NormalizedMediaSettings;
	if (media.sampleRate !== geometry.sampleRate || media.channelCount !== geometry.channelCount
		|| (media.channelMapping as { mode?: unknown }).mode !== 'preserve'
		|| (settings.inputChannelCount !== undefined && settings.inputChannelCount !== geometry.channelCount)) {
		throw new RangeError('Desktop PCM stream geometry must already match the final export settings.');
	}
	const tuple: DesktopAudioCodecCapabilityTuple = { operation: 'audio-encode', format,
		sampleRate: media.sampleRate, channelCount: media.channelCount,
		settings: encodeDesktopAudioSettings(format, media) as DesktopAudioCodecCapabilityTuple['settings'] };
	const capability = await queryDesktopAudioCodecCapability(ports.queryCapability, tuple);
	assertFfmpegOutputReady(settings); ports.assertActive();
	if (!capability.available || capability.provider !== 'bundled') return null;
	const threshold = settings.maximumOutputBytes ?? LARGE_AUDIO_FILE_BYTES;
	if (!Number.isSafeInteger(threshold) || threshold < 1) throw new RangeError('Desktop audio output warning threshold is invalid.');
	const plan = normalizeDesktopAudioStreamPlan({ schemaVersion: 1, frameCount: geometry.frameCount, tuple,
		maximumOutputBytes: Math.max(threshold, geometry.frameCount * media.channelCount * 8 + 16 * 1024 * 1024) });
	let consumed = false;
	const request = (producePcm: DesktopPcmStreamProducer) => {
		ports.assertActive(); assertFfmpegOutputReady(settings);
		if (consumed) throw new Error('The prepared desktop PCM stream was consumed.');
		if (typeof producePcm !== 'function') throw new TypeError('Desktop PCM streaming requires a producer.');
		consumed = true;
		return { producePcm, plan, channelMapping: 'preserve', extension: `.${media.extension}`, mimeType: media.mimeType, settings };
	};
	return Object.freeze({
		async encode(producePcm: DesktopPcmStreamProducer) {
			return await withDesktopAudioStreamOwnership(request(producePcm), ports.mintRequestId(), ports.active,
				(owned) => encodeDesktopAudioStreamFile(owned, ports.bridge));
		},
		async encodeToSink<Output>(producePcm: DesktopPcmStreamProducer, sink: FfmpegOutputSink<Output>) {
			return await withDesktopAudioStreamOwnership(request(producePcm), ports.mintRequestId(), ports.active,
				(owned) => encodeDesktopAudioStreamToSink(owned, ports.bridge, sink));
		},
	});
}
