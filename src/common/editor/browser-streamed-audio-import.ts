/* SPDX-License-Identifier: AGPL-3.0-only */

import { LARGE_AUDIO_FILE_BYTES, LARGE_AUDIO_DURATION_SECONDS } from './large-audio-policy.ts';
import type { BrowserContainerAudioSample } from './browser-container-audio-decode.ts';
import type { WavPackImportGroupDecoder } from './browser-streamed-wavpack-import.ts';

const MAXIMUM_CHANNELS = 32;
const MAXIMUM_SAMPLE_FRAMES = 65_536;
const MAXIMUM_CACHE_BYTES = 4 * 1024 * 1024;

export interface StreamedAudioImportSession {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly durationSeconds: number;
	readonly timelineOrigin: number;
	/** Encoded packet metadata proved there are no internal gaps. */
	readonly continuousTimeline?: boolean;
	/** Native failures interrupt blocked storage; ordinary EOF leaves this signal clear. */
	readonly failureSignal?: AbortSignal;
	samples(): AsyncIterable<BrowserContainerAudioSample>;
	dispose(): void;
}

export interface StreamedAudioImportDescriptor {
	readonly container: 'compressed-audio';
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly mimeType: string;
}

export interface StreamedAudioImportStreamOptions {
	readonly chunkFrames: number;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
	onChunk(channels: Float32Array[]): PromiseLike<unknown> | unknown;
}

export interface PreparedStreamedAudioImport {
	readonly descriptor: StreamedAudioImportDescriptor;
	stream(options: StreamedAudioImportStreamOptions): Promise<void>;
	dispose(): void;
}

/** Admit source geometry before the first PCM allocation; only chunks cross into storage. */
export async function prepareStreamedAudioImport(
	file: Blob,
	options: Readonly<{
		signal?: AbortSignal;
		openSession?: (file: Blob, signal?: AbortSignal) => Promise<StreamedAudioImportSession>;
		reviewedFallback?: boolean;
		desktopCodec?: WavPackImportGroupDecoder;
	}> = {},
): Promise<PreparedStreamedAudioImport> {
	options.signal?.throwIfAborted();
	if (!(file instanceof Blob)) throw new TypeError('A compressed audio Blob is required.');
	if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > LARGE_AUDIO_FILE_BYTES) {
		throw new RangeError('The compressed audio original exceeds the 1 GB import limit.');
	}
	const session = await awaitImportOperation((options.openSession ?? (async (blob, signal) => {
		const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
		if (String.fromCharCode(...header) === 'wvpk') {
			const { openStreamedWavPackImportSession } = await import('./browser-streamed-wavpack-import.ts');
			return openStreamedWavPackImportSession(blob, signal, options.desktopCodec);
		}
		return openBrowserAudioImportSession(blob, signal, options.reviewedFallback !== false, options.desktopCodec);
	}))(file, options.signal), [options.signal], (abandoned) => abandoned.dispose());
	let disposed = false;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		options.signal?.removeEventListener('abort', dispose);
		session.dispose();
	};
	options.signal?.addEventListener('abort', dispose, { once: true });
	try {
		options.signal?.throwIfAborted();
		const descriptor = admittedDescriptor(session, file.type);
		return Object.freeze({
			descriptor, dispose,
			async stream(settings: StreamedAudioImportStreamOptions) {
				if (disposed) throw new Error('The compressed audio import decoder is closed.');
				const assertCurrent = (): void => {
					options.signal?.throwIfAborted();
					settings.signal?.throwIfAborted();
					session.failureSignal?.throwIfAborted();
					settings.assertCurrent?.();
				};
				settings.signal?.addEventListener('abort', dispose, { once: true });
				try { await streamSession(session, descriptor, settings, assertCurrent, [options.signal, settings.signal, session.failureSignal]); }
				finally {
					settings.signal?.removeEventListener('abort', dispose);
					dispose();
				}
			},
		});
	} catch (error) {
		dispose();
		throw error;
	}
}

function admittedDescriptor(session: StreamedAudioImportSession, mimeType: string): StreamedAudioImportDescriptor {
	if (!Number.isSafeInteger(session.sampleRate) || session.sampleRate < 1 || session.sampleRate > 768_000
		|| !Number.isSafeInteger(session.channelCount) || session.channelCount < 1 || session.channelCount > MAXIMUM_CHANNELS
		|| !Number.isFinite(session.timelineOrigin)) throw new RangeError('The compressed audio source geometry is unsupported.');
	if (!Number.isFinite(session.durationSeconds) || session.durationSeconds <= 0
		|| session.durationSeconds > LARGE_AUDIO_DURATION_SECONDS) {
		throw new RangeError('The compressed audio source exceeds the one-hour import duration limit.');
	}
	const frameCount = Math.round(session.durationSeconds * session.sampleRate);
	if (!Number.isSafeInteger(frameCount) || frameCount < 1
		|| !Number.isSafeInteger(frameCount * session.channelCount * 4)) {
		throw new RangeError('The compressed audio source frame count is unsupported.');
	}
	return Object.freeze({ container: 'compressed-audio', sampleRate: session.sampleRate,
		channelCount: session.channelCount, frameCount, mimeType: mimeType || 'audio/mpeg' });
}

async function streamSession(
	session: StreamedAudioImportSession,
	descriptor: StreamedAudioImportDescriptor,
	options: StreamedAudioImportStreamOptions,
	assertCurrent: () => void,
	signals: readonly (AbortSignal | undefined)[],
): Promise<void> {
	assertCurrent();
	const { chunkFrames } = options;
	if (!Number.isSafeInteger(chunkFrames) || chunkFrames < 1 || chunkFrames > MAXIMUM_SAMPLE_FRAMES) {
		throw new RangeError('The compressed audio import chunk size is unsupported.');
	}
	let chunk = allocateChunk(descriptor.channelCount, chunkFrames);
	let used = 0;
	let position = 0;
	let decodedSamples = 0;
	let continuousStart: number | null = null;
	let decodedPosition = 0;
	const emit = async (): Promise<void> => {
		assertCurrent();
		await awaitImportOperation(Promise.resolve(options.onChunk(used === chunkFrames ? chunk : chunk.map((channel) => channel.slice(0, used)))), signals, () => undefined);
		assertCurrent();
		used = 0;
		chunk = allocateChunk(descriptor.channelCount, chunkFrames);
	};
	const padTo = async (end: number): Promise<void> => {
		while (position < end) {
			assertCurrent();
			const count = Math.min(chunkFrames - used, end - position);
			used += count;
			position += count;
			if (used === chunkFrames) await emit();
		}
	};
	const iterator = session.samples()[Symbol.asyncIterator]();
	try { while (true) {
		const next = await awaitImportOperation(iterator.next(), signals, (abandoned) => {
			if (!abandoned.done) abandoned.value.close();
		});
		if (next.done) break;
		const sample = next.value;
		try {
			assertCurrent();
			validateSample(sample, descriptor);
			const timestampStart = Math.round((sample.timestamp - session.timelineOrigin) * descriptor.sampleRate);
			continuousStart ??= timestampStart;
			const rawStart = session.continuousTimeline ? continuousStart + decodedPosition : timestampStart;
			decodedPosition += sample.numberOfFrames;
			if (!Number.isSafeInteger(rawStart)) throw new RangeError('A compressed audio timestamp is outside the safe range.');
			if (rawStart >= descriptor.frameCount) break;
			const overlap = Math.max(0, position - Math.max(0, rawStart));
			if (overlap > Math.ceil(descriptor.sampleRate / 1_000)) throw new RangeError('Compressed audio samples overlap.');
			await padTo(Math.max(position, rawStart));
			let offset = Math.max(0, -rawStart) + overlap;
			while (offset < sample.numberOfFrames && position < descriptor.frameCount) {
				assertCurrent();
				const count = Math.min(sample.numberOfFrames - offset, chunkFrames - used, descriptor.frameCount - position);
				for (let channel = 0; channel < descriptor.channelCount; channel += 1) {
					sample.copyTo(chunk[channel]!.subarray(used, used + count), {
						planeIndex: channel, format: 'f32-planar', frameOffset: offset, frameCount: count,
					});
				}
				used += count;
				position += count;
				offset += count;
				decodedSamples += count;
				if (used === chunkFrames) await emit();
			}
		} finally { sample.close(); }
	} } finally { void iterator.return?.().catch(() => undefined); }
	assertCurrent();
	if (decodedSamples < 1) throw new Error('The source has no decodable compressed audio samples.');
	if (descriptor.frameCount - position > 1) throw new Error('The decoded compressed audio ended before its declared duration.');
	await padTo(descriptor.frameCount);
	if (used) await emit();
}

function allocateChunk(channels: number, frames: number): Float32Array[] {
	return Array.from({ length: channels }, () => new Float32Array(frames));
}

function validateSample(sample: BrowserContainerAudioSample, descriptor: StreamedAudioImportDescriptor): void {
	if (sample.sampleRate !== descriptor.sampleRate || sample.numberOfChannels !== descriptor.channelCount
		|| !Number.isSafeInteger(sample.numberOfFrames) || sample.numberOfFrames < 1 || sample.numberOfFrames > MAXIMUM_SAMPLE_FRAMES
		|| !Number.isFinite(sample.timestamp) || !Number.isFinite(sample.duration) || sample.duration <= 0) {
		throw new RangeError('The decoded compressed audio sample geometry changed or is unsupported.');
	}
}

async function openBrowserAudioImportSession(file: Blob, signal?: AbortSignal, reviewedFallback = true,
	desktopCodec?: WavPackImportGroupDecoder): Promise<StreamedAudioImportSession> {
	signal?.throwIfAborted();
	const { ALL_FORMATS, AudioSample, AudioSampleSink, BlobSource, EncodedPacketSink, Input } = await import('mediabunny');
	const { readAacSourceMetadata, validateAacSourceGeometry } = await import('./aac-source-geometry.ts');
	const aacMetadata = await readAacSourceMetadata(file, signal);
	signal?.throwIfAborted();
	// Slice reads also work for desktop range-backed Blobs; never consume a whole-file stream.
	const input = new Input({ source: new BlobSource(file, { maxCacheSize: MAXIMUM_CACHE_BYTES, useStreamReader: false }), formats: ALL_FORMATS });
	const onAbort = (): void => input.dispose();
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
		if (!reviewedFallback) {
			const { disableReviewedAudioImportDecoders } = await import('./browser-reviewed-streamed-audio-decoders.ts');
			disableReviewedAudioImportDecoders();
		}
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('The source has no primary audio track.');
		const codec = await track.getCodec();
		let layerII = false;
		if (codec === 'mp3') {
			const packets = new EncodedPacketSink(track);
			const metadata = await packets.getFirstPacket({ metadataOnly: true });
			if (metadata && metadata.byteLength > 1024 * 1024) throw new RangeError('The MPEG audio packet exceeds its bounded import size.');
			const first = await packets.getFirstPacket();
			layerII = Boolean(first && first.data[0] === 255 && (first.data[1]! & 224) === 224 && ((first.data[1]! >> 1) & 3) === 2);
		}
		// Native support flags do not prove these codecs can produce PCM. Select the
		// reviewed bounded decoder before publication, without restarting a stream.
		if (reviewedFallback && (codec === 'flac' || codec === 'vorbis' || codec === 'mp3')) {
			const config = await track.getDecoderConfig();
			const { preferReviewedAudioImportDecoder } = await import('./browser-reviewed-streamed-audio-decoders.ts');
			if (config && preferReviewedAudioImportDecoder(codec, config)) track.getDecoderConfig = () => Promise.resolve(config);
			else if (layerII) throw new Error('The reviewed MPEG LayerII decoder does not support this source configuration.');
		}
		if (!(layerII && !reviewedFallback) && !await track.canDecode()) {
			if (!reviewedFallback) throw new Error('This desktop browser cannot incrementally decode the compressed audio track.');
			const { enableReviewedAudioImportDecoder } = await import('./browser-reviewed-streamed-audio-decoders.ts');
			enableReviewedAudioImportDecoder(await track.getCodec());
			if (!await track.canDecode()) throw new Error('This browser cannot incrementally decode the compressed audio track.');
		}
		const [sampleRate, channelCount, timelineOrigin, endTimestamp] = await Promise.all([
			track.getSampleRate(), track.getNumberOfChannels(), track.getFirstTimestamp(), track.computeDuration(),
		]);
		let origin = Math.max(0, timelineOrigin);
		let durationSeconds = endTimestamp - origin;
		if (layerII && !reviewedFallback) {
			const { openDesktopMpegLayerIIImportSession } = await import('./desktop-mpeg-layer-ii-import.ts');
			input.dispose();
			return openDesktopMpegLayerIIImportSession(file, { sampleRate, channelCount, timelineOrigin: origin,
				durationSeconds }, signal, desktopCodec);
		}
		if (aacMetadata !== null) {
			const profile = await track.getCodecParameterString();
			if (codec !== 'aac' || profile !== 'mp4a.40.2' || timelineOrigin < 0) throw new Error('The AAC source geometry requires its qualified AAC-LC profile and timeline.');
			let encodedFrames = 0;
			for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
				signal?.throwIfAborted();
				if (packet.byteLength < 1 || packet.byteLength > 1024 * 1024
					|| Math.abs(packet.duration * sampleRate - 1024) > 1e-5
					|| Math.abs((packet.timestamp - origin) * sampleRate - encodedFrames) > 1e-5) {
					throw new Error('The AAC source geometry differs from its encoded packet sequence.');
				}
				encodedFrames += 1024;
				if (encodedFrames % (1024 * 1024) === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
			if (Math.abs(durationSeconds * sampleRate - encodedFrames) > 1e-5) throw new Error('The AAC source geometry differs from its encoded duration.');
			const gapless = validateAacSourceGeometry(aacMetadata, { sampleRate, channelCount, encodedFrames });
			origin += gapless.leadingFrames / sampleRate;
			durationSeconds = gapless.sourceFrames / sampleRate;
		}
		if (codec === 'mp3') {
			const { inspectMp3GaplessGeometry } = await import('./mp3-gapless-import.ts');
			const gapless = await inspectMp3GaplessGeometry(file);
			if (gapless) {
				if (gapless.sampleRate !== sampleRate || Math.abs(Math.round(durationSeconds * sampleRate) - gapless.encodedFrames) > 1) {
					throw new Error('The MP3 gapless geometry differs from its encoded packet duration.');
				}
				origin += gapless.leadingFrames / sampleRate;
				durationSeconds = gapless.sourceFrames / sampleRate;
			}
		}
		if (codec === 'opus' || codec === 'vorbis') {
			const { inspectOggGaplessGeometry } = await import('./ogg-gapless-import.ts');
			const gapless = await inspectOggGaplessGeometry(file, codec);
			if (gapless) {
				if (gapless.sampleRate !== sampleRate || gapless.sourceFrames > Math.round(durationSeconds * sampleRate) + 1) {
					throw new Error('The Ogg final granule exceeds its encoded packet duration.');
				}
				durationSeconds = gapless.sourceFrames / sampleRate;
			}
		}
		signal?.throwIfAborted();
		const continuousTimeline = codec === 'aac' && await hasContinuousAudioPacketTimeline(
			new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true }), sampleRate, signal,
		);
		if (codec === 'aac') {
			const config = await track.getDecoderConfig();
			if (!config) throw new Error('This browser cannot incrementally decode the compressed audio track.');
			const { createNativeStreamedAacImport } = await import('./browser-native-streamed-aac-import.ts');
			const native = createNativeStreamedAacImport({ config, packets: () => new EncodedPacketSink(track).packets(),
				wrapSample: data => new AudioSample(data), ...(signal ? { signal } : {}),
			});
			return Object.freeze({ sampleRate, channelCount, timelineOrigin: origin, durationSeconds, continuousTimeline,
				samples: native.samples, failureSignal: native.failureSignal, dispose() { native.dispose(); input.dispose(); },
			});
		}
		const sink = new AudioSampleSink(track);
		return Object.freeze({ sampleRate, channelCount, timelineOrigin: origin, durationSeconds, continuousTimeline,
			samples: () => sink.samples(), dispose: () => input.dispose(),
		});
	} catch (error) {
		input.dispose();
		signal?.throwIfAborted();
		throw error;
	} finally { signal?.removeEventListener('abort', onAbort); }
}

/** Only a dense encoded timeline permits replacing inaccurate native sample timestamps. */
export async function hasContinuousAudioPacketTimeline(
	packets: AsyncIterable<Readonly<{ timestamp: number; duration: number; byteLength: number }>>,
	sampleRate: number, signal?: AbortSignal,
): Promise<boolean> {
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 1) return false;
	let end: number | null = null;
	let count = 0;
	for await (const packet of packets) {
		signal?.throwIfAborted();
		const start = packet.timestamp * sampleRate;
		const frames = Math.round(packet.duration * sampleRate);
		if (!Number.isFinite(start) || !Number.isSafeInteger(frames) || frames < 1
			|| packet.byteLength < 1 || packet.byteLength > 1024 * 1024
			|| (end !== null && Math.abs(start - end) > 1)) return false;
		end = (end ?? Math.round(start)) + frames;
		if (!Number.isSafeInteger(end)) return false;
		if (++count % 1024 === 0) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
	}
	signal?.throwIfAborted();
	return count > 0;
}

function awaitImportOperation<Value>(
	operation: Promise<Value>, signals: readonly (AbortSignal | undefined)[], releaseAbandoned: (value: Value) => void,
): Promise<Value> {
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		let abandoned = false;
		const listeners: (() => void)[] = [];
		const cleanup = (): void => { for (const remove of listeners) remove(); };
		for (const signal of signals) {
			if (!signal) continue;
			const abort = (): void => {
				if (settled) return;
				settled = abandoned = true; cleanup(); reject(signal.reason);
			};
			signal.addEventListener('abort', abort, { once: true });
			listeners.push(() => { signal.removeEventListener('abort', abort); });
			if (signal.aborted) { abort(); break; }
		}
		void operation.then((value) => {
			if (abandoned) { try { releaseAbandoned(value); } catch { /* Cancellation remains primary. */ } return; }
			settled = true; cleanup(); resolve(value);
		}, (error: unknown) => { if (!settled) { settled = true; cleanup(); reject(error); } });
	});
}
