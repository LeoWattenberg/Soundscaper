/* SPDX-License-Identifier: AGPL-3.0-only */
import { applyMediaChannelMapping, normalizeMediaExportSettings } from './media-export.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from './wav-import.js';
import { writeInterleavedFloat32Pcm } from './interleaved-float32-pcm.ts';
import type { WavPcmDescriptor } from './wav-pcm-chunk-reader.ts';
import { LARGE_AUDIO_DURATION_SECONDS, LARGE_AUDIO_FILE_BYTES, LARGE_AUDIO_PCM_CHUNK_FRAMES } from './large-audio-policy.ts';
import { openBrowserAudioEncodeStreamSession, type BrowserAudioEncodeStreamSession } from './browser-audio-encode-stream-client.ts';
import { createTemporaryFileSink, type TemporaryFileSink } from './controller/export/temporary-export.ts';
import type { BrowserDedicatedAudioFormat } from './browser-dedicated-audio-codec.ts';
import type { BrowserAudioCodecRuntimeSettings } from './browser-audio-codec-runtime.ts';
import type { DedicatedAudioEncodeSessionRequest } from './dedicated-audio-encode-session.ts';
import { validateProfile } from './browser-dedicated-audio-profiles.ts';
import { mp3CodecRateSettings, opusCodecRateSettings } from './media-export.js';
import { streamFfmpegOutputFile, type FfmpegOutputSink } from './ffmpeg-output-stream.ts';
import { validateStreamedAudioOutput } from './browser-streamed-audio-output-validation.ts';

interface StreamMedia {
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly channelMapping: unknown;
	readonly extension: string;
	readonly mimeType: string;
	readonly metadata: Readonly<Record<string, string>>;
	readonly compressionLevel?: number;
	readonly quality?: number;
	readonly bitRate?: number;
}
interface StreamEncodeDependencies {
	readonly openSession?: (request: DedicatedAudioEncodeSessionRequest, options: Readonly<{ signal?: AbortSignal }>) => Promise<BrowserAudioEncodeStreamSession>;
	readonly createSink?: () => Promise<TemporaryFileSink>;
	readonly validateOutput?: typeof validateStreamedAudioOutput;
}

export function assertStreamedBrowserCodecInput(format: BrowserDedicatedAudioFormat | 'aac-m4a', media: StreamMedia, frames: number): void {
	if (!Number.isSafeInteger(frames) || frames < 1 || frames > media.sampleRate * LARGE_AUDIO_DURATION_SECONDS) {
		throw new RangeError('The streamed audio export exceeds the one-hour duration limit.');
	}
	if (format !== 'aac-m4a') {
		if (Object.keys(media.metadata).length) throw new Error('The dedicated browser encoder does not write metadata tags.');
		validateProfile(format, { frameCount: Math.min(frames, LARGE_AUDIO_PCM_CHUNK_FRAMES), ...media }, codecSettings(format, media));
	}
}

/** Read, map, encode and stage one packet at a time, preserving the final file's storage owner. */
export async function encodeBrowserAudioFileStreamed(
	file: Blob,
	format: BrowserDedicatedAudioFormat | 'aac-m4a',
	settings: BrowserAudioCodecRuntimeSettings,
	capabilities: unknown,
	dependencies: StreamEncodeDependencies = {},
) {
	const signal = settings.signal;
	const assertCurrent = (): void => {
		if (signal?.aborted) throw signal.reason ?? new DOMException('The audio export was cancelled.', 'AbortError');
		settings.assertCurrent?.();
	};
	assertCurrent();
	const descriptor = await inspectWavBlobPcm(file, signal ? { signal } : {}) as WavPcmDescriptor;
	if (settings.inputChannelCount !== undefined && settings.inputChannelCount !== descriptor.channelCount) {
		throw new RangeError('The staged WAV channel count does not match its codec plan.');
	}
	const media = normalizeMediaExportSettings(format, {
		...settings, capabilities, inputChannelCount: descriptor.channelCount,
		sampleRate: settings.sampleRate ?? descriptor.sampleRate,
	}) as StreamMedia;
	if (media.sampleRate !== descriptor.sampleRate) throw new RangeError('The staged WAV must already have the requested export sample rate.');
	assertStreamedBrowserCodecInput(format, media, descriptor.frameCount);
	const maximum = settings.maximumOutputBytes ?? LARGE_AUDIO_FILE_BYTES;
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > LARGE_AUDIO_FILE_BYTES) throw new RangeError('The audio export file-byte limit is invalid.');
	const sink = await (dependencies.createSink ?? defaultSink)();
	let byteLength = 0;
	let session: BrowserAudioEncodeStreamSession | null = null;
	const write = async (bytes: Uint8Array): Promise<void> => {
		assertCurrent();
		if (bytes.byteLength > maximum - byteLength) throw new RangeError('The encoded audio export exceeds its file-byte limit.');
		if (!sink.persistent && bytes.byteLength > 96 * 1024 ** 2 - byteLength) throw new Error('Large compressed audio exports require origin-private file storage.');
		if (bytes.byteLength) await sink.write(bytes);
		byteLength += bytes.byteLength;
		assertCurrent();
	};
	const readPcm = async (accept: (bytes: Uint8Array<ArrayBuffer>, frames: number, offset: number) => Promise<void>): Promise<void> => {
		await streamWavBlobPcm(file, {
			descriptor, chunkFrames: LARGE_AUDIO_PCM_CHUNK_FRAMES, ...(signal ? { signal } : {}),
			async onChunk(packet: readonly Float32Array[], details: Readonly<{ frames: number; frameOffset: number }>) {
				assertCurrent();
				const channels = applyMediaChannelMapping(packet, media.channelMapping as never) as readonly Float32Array[];
				if (channels.length !== media.channelCount) throw new RangeError('The streamed channel mapping changed its geometry.');
				const bytes = new Uint8Array(details.frames * channels.length * 4);
				writeInterleavedFloat32Pcm(bytes, channels, {
					frameCount: details.frames, nonFinite: 'zero',
				});
				await accept(bytes, details.frames, details.frameOffset);
				settings.onProgress?.((details.frameOffset + details.frames) / descriptor.frameCount);
				assertCurrent();
			},
		});
	};
	try {
		settings.onProgress?.(0);
		if (format === 'aac-m4a') {
			const { encodeBrowserAacStreamed } = await import('./browser-webcodecs-aac-stream.ts');
			await encodeBrowserAacStreamed({
				...media, frameCount: descriptor.frameCount, bitrate: media.bitRate! * 1000,
				readPcm, write, ...(signal ? { signal } : {}),
			});
		} else {
			session = await (dependencies.openSession ?? openBrowserAudioEncodeStreamSession)({
				format, frameCount: descriptor.frameCount, channelCount: media.channelCount, sampleRate: media.sampleRate,
				settings: codecSettings(format, media),
			}, signal ? { signal } : {});
			const active = session;
			await readPcm(async (bytes, frames) => write(await active.write(bytes, frames)));
			const final = await active.finish();
			await write(final.bytes);
			if (final.prefixPatch.byteLength) {
				if (final.prefixPatch.byteLength > byteLength) throw new RangeError('The codec header patch exceeds the encoded file.');
				await sink.writeAt(0, final.prefixPatch);
			}
		}
		assertCurrent();
		const blob = await sink.close(media.mimeType);
		if (blob.size !== byteLength) throw new Error('The encoded file size does not match its streamed writes.');
		await (dependencies.validateOutput ?? validateStreamedAudioOutput)(blob, {
			format, frameCount: descriptor.frameCount, channelCount: media.channelCount, sampleRate: media.sampleRate,
			...(signal ? { signal } : {}),
		});
		assertCurrent();
		return Object.freeze({ blob, bytes: new Uint8Array(new ArrayBuffer(0)), extension: `.${media.extension}`, mimeType: media.mimeType, cleanup: () => sink.remove() });
	} catch (error) {
		try { await sink.abort(); }
		catch (cleanupError) { throw cleanupFailure(error, cleanupError); }
		throw error;
	} finally { session?.close(); }
}

function codecSettings(format: BrowserDedicatedAudioFormat, media: StreamMedia): Readonly<Record<string, number>> {
	if (format === 'mp3') return mp3CodecRateSettings(media);
	if (format === 'opus') return opusCodecRateSettings(media);
	if (format === 'flac' || format === 'wavpack') return { compressionLevel: media.compressionLevel! };
	if (format === 'ogg-vorbis') return { quality: media.quality! };
	return { bitrateKbps: media.bitRate! };
}
function defaultSink(): Promise<TemporaryFileSink> {
	return createTemporaryFileSink(`encoded-audio-${crypto.randomUUID()}.tmp`, {
		temporaryExportClosed: 'The audio export file is closed.', largeStemsStorageRequired: 'Large exports require file storage.', stemArchiveClosed: 'The archive is closed.',
	});
}

export async function streamBrowserAudioEncodedResult<Output>(
	encoded: Readonly<{ blob?: Blob; bytes: Uint8Array; extension: string; mimeType: string; cleanup?: () => Promise<void> }>,
	sink: FfmpegOutputSink<Output>, settings: BrowserAudioCodecRuntimeSettings,
) {
	let result: Awaited<ReturnType<typeof streamFfmpegOutputFile<Output>>>;
	try {
		result = await streamFfmpegOutputFile({
			async statFile() { return { size: encoded.blob?.size ?? encoded.bytes.byteLength }; },
			async readFileRange(_path, offset, maximumBytes) {
				return encoded.blob ? new Uint8Array(await encoded.blob.slice(offset, offset + maximumBytes).arrayBuffer())
					: encoded.bytes.slice(offset, offset + maximumBytes);
			},
		}, 'audio-encoded-file', sink, {
			...(settings.signal ? { signal: settings.signal } : {}),
			...(settings.assertCurrent ? { assertCurrent: settings.assertCurrent } : {}),
			...(settings.maximumOutputChunkBytes ? { maximumChunkBytes: settings.maximumOutputChunkBytes } : {}),
		});
	} catch (error) {
		try { await encoded.cleanup?.(); }
		catch (cleanupError) { throw cleanupFailure(error, cleanupError); }
		throw error;
	}
	await encoded.cleanup?.();
	return Object.freeze({ ...result, extension: encoded.extension, mimeType: encoded.mimeType });
}

function cleanupFailure(primary: unknown, cleanup: unknown): AggregateError {
	return new AggregateError([primary, cleanup], 'Audio export failed and its staged file could not be removed.', { cause: primary });
}
