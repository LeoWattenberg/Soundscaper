/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeDesktopAudioStreamPlan, DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_FRAMES,
	type DesktopAudioStreamPlan } from '../../../desktop/desktop-audio-stream-contract.ts';
import type { DesktopAudioCodecFormat } from '../../../desktop/desktop-audio-codec-operation-contract.ts';
import type { DesktopAudioCodecCapabilityTuple } from '../../../desktop/desktop-audio-codec-capability-contract.ts';
import { createMediaExportCapabilities, normalizeMediaExportSettings } from './media-export.js';
import { encodeDesktopAudioSettings } from './desktop-audio-stream-request.ts';
import { queryDesktopAudioCodecCapability } from './desktop-audio-codec-capabilities.ts';
import type { DesktopAudioCodecRuntimeSettings, NormalizedMediaSettings } from './desktop-audio-codec-runtime.ts';
import { encodeDesktopAudioStreamFile, encodeDesktopAudioStreamToSink, withDesktopAudioStreamOwnership,
	type DesktopAudioStreamCommandBridge, type DesktopAudioStreamFileResult,
	type DesktopAudioStreamEncoderSettings } from './desktop-audio-stream-encoder.ts';
import { assertFfmpegOutputReady, type FfmpegOutputSink } from './ffmpeg-output-stream.ts';
import { writeInterleavedFloat32Pcm } from './interleaved-float32-pcm.ts';
import { LARGE_AUDIO_FILE_BYTES } from './large-audio-policy.ts';

export interface DesktopPcmStreamGeometry {
	readonly frameCount: number; readonly channelCount: number; readonly sampleRate: number;
}
export type DesktopPcmStreamWrite = (channels: readonly Float32Array[]) => Promise<void>;
/** Each write borrows its input until the returned acknowledgement settles. */
export type DesktopPcmStreamProducer = (write: DesktopPcmStreamWrite) => Promise<void>;
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

/** Coalesce small render quanta, splitting larger windows, with one native write in flight. */
export async function writeDesktopPcmStream(produce: DesktopPcmStreamProducer, plan: DesktopAudioStreamPlan,
	settings: DesktopAudioStreamEncoderSettings, write: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
	const capacity = DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_FRAMES;
	const scratch = Array.from({ length: plan.tuple.channelCount }, () => new Float32Array(capacity));
	let buffered = 0; let received = 0;
	let pending: Promise<void> | null = null; let packetFailure: unknown; let failedPacket = false;
	const flush = async (): Promise<void> => {
		if (!buffered) return;
		assertFfmpegOutputReady(settings);
		const bytes = new Uint8Array(buffered * scratch.length * 4);
		// The established preserve mapping adds each sample to +0 before encoding.
		// Match its signed-zero normalization as well as float WAV nonfinite handling.
		for (const channel of scratch) for (let index = 0; index < buffered; index++) if (channel[index] === 0) channel[index] = 0;
		writeInterleavedFloat32Pcm(bytes, scratch, { frameCount: buffered, nonFinite: 'zero' });
		await write(bytes); assertFfmpegOutputReady(settings); buffered = 0;
	};
	const accept = async (channels: readonly Float32Array[]): Promise<void> => {
		assertFfmpegOutputReady(settings);
		if (!Array.isArray(channels) || channels.length !== scratch.length
			|| channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== channels[0]?.length)) {
			throw new RangeError('Desktop PCM stream channel geometry changed.');
		}
		const frames = channels[0]!.length;
		if (frames > plan.frameCount - received) throw new RangeError('Desktop PCM stream frame count exceeds its plan.');
		received += frames;
		{
			for (let first = 0; first < frames;) {
				const count = Math.min(capacity - buffered, frames - first);
				for (let channel = 0; channel < scratch.length; channel++) scratch[channel]!.set(channels[channel]!.subarray(first, first + count), buffered);
				buffered += count; first += count;
				if (buffered === capacity) await flush();
			}
		}
	};
	let producerFailure: unknown; let failedProducer = false;
	try {
		await produce((channels) => {
			if (pending) {
				const error = new Error('Desktop PCM producers must await each write acknowledgement.');
				failedPacket = true; packetFailure = error;
				const rejected = Promise.reject<void>(error); void rejected.catch(() => undefined); return rejected;
			}
			const operation = accept(channels); pending = operation;
			void operation.then(() => { pending = null; }, (error: unknown) => {
				pending = null; failedPacket = true; packetFailure = error;
			});
			return operation;
		});
	} catch (error) { failedProducer = true; producerFailure = error; }
	const unacknowledged = pending !== null;
	if (pending) { try { await pending; } catch { /* The primary packet failure is retained above. */ } }
	if (failedProducer) throw producerFailure;
	if (failedPacket) throw packetFailure;
	if (unacknowledged) throw new Error('Desktop PCM producers must await each write acknowledgement.');
	assertFfmpegOutputReady(settings);
	if (received !== plan.frameCount) throw new RangeError('Desktop PCM stream frame count does not match its plan.');
	await flush();
}
