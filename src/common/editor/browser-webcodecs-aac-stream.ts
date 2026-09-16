/* SPDX-License-Identifier: AGPL-3.0-only */
import { AppendOnlyStreamTarget, AudioSample, AudioSampleSource, Mp4OutputFormat, Output } from 'mediabunny';
import { browserAacMetadataTags } from './browser-aac-metadata.ts';
import { aacSourceMetadata, validateAacSourceGeometry } from './aac-source-geometry.ts';
import { BROWSER_AAC_WEB_CODECS_CODEC, probeBrowserWebCodecsAudioEncoding } from './browser-webcodecs-audio-profile.ts';

interface StreamedAacRequest {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly bitrate: number;
	readonly frameCount: number;
	readonly metadata: Readonly<Record<string, string>>;
	readonly signal?: AbortSignal;
	readPcm(accept: (bytes: Uint8Array<ArrayBuffer>, frames: number, offset: number) => Promise<void>): Promise<void>;
	write(bytes: Uint8Array): Promise<void>;
}

/** Fragmented MP4 keeps a persistent native AAC encoder and bounded sequential mux output. */
export async function encodeBrowserAacStreamed(request: StreamedAacRequest): Promise<void> {
	const assertCurrent = (): void => {
		if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('The AAC export was cancelled.', 'AbortError');
	};
	assertCurrent();
	if (!await probeBrowserWebCodecsAudioEncoding('aac', request)) throw new Error('This browser cannot encode the requested AAC configuration.');
	assertCurrent();
	const output = new Output({
		format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }),
		target: new AppendOnlyStreamTarget(new WritableStream<Uint8Array>({ write: (bytes) => request.write(bytes) })),
	});
	const sourceMetadata = aacSourceMetadata(request.sampleRate, request.channelCount, request.frameCount);
	let acceptedFrames = 0;
	let encodedFrames = 0;
	let invalidPackets = false;
	const source = new AudioSampleSource({
		codec: 'aac', fullCodecString: BROWSER_AAC_WEB_CODECS_CODEC, bitrate: request.bitrate,
		onEncodedPacket(packet) {
			const frames = packet.duration === 0 ? 1_024 : Math.round(packet.duration * request.sampleRate);
			if (!packet.data.length || packet.data.length > 1024 ** 2 || frames !== 1_024
				|| Math.abs(packet.timestamp * request.sampleRate - encodedFrames) > 1e-5) invalidPackets = true;
			encodedFrames += frames;
		},
	});
	output.addAudioTrack(source);
	output.setMetadataTags({ ...browserAacMetadataTags(request.metadata), raw: { scaf: sourceMetadata } });
	let cancellation: Promise<void> | null = null;
	let finalized = false;
	const cancel = (): Promise<void> => cancellation ??= finalized ? Promise.resolve() : output.cancel().catch(() => undefined);
	const onAbort = (): void => { void cancel(); };
	request.signal?.addEventListener('abort', onAbort, { once: true });
	try {
		await output.start();
		await request.readPcm(async (bytes, frames, offset) => {
			assertCurrent();
			if (!Number.isSafeInteger(frames) || frames < 1 || frames > 16_384 || offset !== acceptedFrames
				|| acceptedFrames + frames > request.frameCount || bytes.byteLength !== frames * request.channelCount * 4) throw new RangeError('The AAC streaming PCM geometry is invalid.');
			const sample = new AudioSample({
				format: 'f32', sampleRate: request.sampleRate, numberOfChannels: request.channelCount,
				timestamp: offset / request.sampleRate, data: bytes,
			});
			try { await source.add(sample); } finally { sample.close(); }
			acceptedFrames += frames;
			assertCurrent();
		});
		if (acceptedFrames !== request.frameCount) throw new RangeError('The AAC streaming PCM source is incomplete.');
		await output.finalize();
		finalized = true;
		assertCurrent();
		if (invalidPackets) throw new RangeError('The native AAC encoded packet geometry is outside its qualified profile.');
		validateAacSourceGeometry(sourceMetadata, { sampleRate: request.sampleRate, channelCount: request.channelCount, encodedFrames });
	} catch (error) {
		await cancel(); assertCurrent(); throw error;
	} finally { request.signal?.removeEventListener('abort', onAbort); }
}
