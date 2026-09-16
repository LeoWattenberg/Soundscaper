/* SPDX-License-Identifier: AGPL-3.0-only */
import { AppendOnlyStreamTarget, EncodedAudioPacketSource, Mp4OutputFormat, Output } from 'mediabunny';
import { browserAacMetadataTags } from './browser-aac-metadata.ts';
import { aacSourceMetadata, validateAacSourceGeometry } from './aac-source-geometry.ts';
import { probeBrowserWebCodecsAudioEncoding } from './browser-webcodecs-audio-profile.ts';
import { awaitNativeAacAbort, createNativeAacEncoder, NATIVE_AAC_ACCESS_UNIT_FRAMES, type NativeAacResources } from './browser-native-aac-encoder.ts';

interface StreamedAacRequest {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly bitrate: number;
	readonly frameCount: number;
	readonly metadata: Readonly<Record<string, string>>;
	readonly signal?: AbortSignal;
	readonly nativeResources?: NativeAacResources;
	readPcm(accept: (bytes: Uint8Array<ArrayBuffer>, frames: number, offset: number) => Promise<void>): Promise<void>;
	write(bytes: Uint8Array): Promise<void>;
}

/** Fragmented MP4 keeps a persistent native AAC encoder and bounded sequential mux output. */
export async function encodeBrowserAacStreamed(request: StreamedAacRequest): Promise<void> {
	const assertCurrent = (): void => {
		if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('The AAC export was cancelled.', 'AbortError');
	};
	assertCurrent();
	if (!await awaitNativeAacAbort(probeBrowserWebCodecsAudioEncoding('aac', request), request.signal)) throw new Error('This browser cannot encode the requested AAC configuration.');
	assertCurrent();
	let encoder: ReturnType<typeof createNativeAacEncoder> | undefined;
	const output = new Output({
		format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }),
		target: new AppendOnlyStreamTarget(new WritableStream<Uint8Array>({ async write(bytes) {
			assertCurrent(); encoder?.assertCurrent();
			const writing = request.write(bytes);
			if (encoder) await encoder.wait(writing);
			else await awaitNativeAacAbort(writing, request.signal);
			assertCurrent(); encoder?.assertCurrent();
		} })),
	});
	const sourceMetadata = aacSourceMetadata(request.sampleRate, request.channelCount, request.frameCount);
	let acceptedFrames = 0;
	const source = new EncodedAudioPacketSource('aac');
	output.addAudioTrack(source);
	output.setMetadataTags({ ...browserAacMetadataTags(request.metadata), raw: { scaf: sourceMetadata } });
	let cancellation: Promise<void> | null = null;
	let finalized = false;
	const cancel = (): Promise<void> => cancellation ??= finalized ? Promise.resolve() : output.cancel().catch(() => undefined);
	const onAbort = (): void => { void cancel(); };
	request.signal?.addEventListener('abort', onAbort, { once: true });
	try {
		await awaitNativeAacAbort(output.start(), request.signal);
		encoder = createNativeAacEncoder({ ...request, acceptPacket: (packet, metadata) => source.add(packet, metadata) }, request.nativeResources);
		const activeEncoder = encoder;
		const unit = new Uint8Array(NATIVE_AAC_ACCESS_UNIT_FRAMES * request.channelCount * 4);
		let bufferedBytes = 0;
		let submittedFrames = 0;
		const submitUnit = async (): Promise<void> => {
			await activeEncoder.add(unit, submittedFrames);
			submittedFrames += NATIVE_AAC_ACCESS_UNIT_FRAMES;
			bufferedBytes = 0;
		};
		await activeEncoder.wait(request.readPcm(async (bytes, frames, offset) => {
			assertCurrent();
			if (!Number.isSafeInteger(frames) || frames < 1 || frames > 16_384 || offset !== acceptedFrames
				|| acceptedFrames + frames > request.frameCount || bytes.byteLength !== frames * request.channelCount * 4) throw new RangeError('The AAC streaming PCM geometry is invalid.');
			// WebKit repeats an input block's timing for every packet it produces.
			// One complete access unit per input preserves native packet identity.
			for (let start = 0; start < bytes.byteLength;) {
				const count = Math.min(unit.byteLength - bufferedBytes, bytes.byteLength - start);
				unit.set(bytes.subarray(start, start + count), bufferedBytes);
				bufferedBytes += count; start += count;
				if (bufferedBytes === unit.byteLength) await submitUnit();
			}
			acceptedFrames += frames;
			assertCurrent();
		}));
		if (acceptedFrames !== request.frameCount) throw new RangeError('The AAC streaming PCM source is incomplete.');
		if (bufferedBytes) { unit.fill(0, bufferedBytes); await submitUnit(); }
		const encodedFrames = await activeEncoder.flush();
		validateAacSourceGeometry(sourceMetadata, { sampleRate: request.sampleRate, channelCount: request.channelCount, encodedFrames });
		await activeEncoder.wait(output.finalize());
		finalized = true;
		assertCurrent();
	} catch (error) {
		encoder?.dispose();
		await awaitNativeAacAbort(cancel(), request.signal).catch(() => undefined); assertCurrent(); throw error;
	} finally { encoder?.dispose(); request.signal?.removeEventListener('abort', onAbort); }
}
