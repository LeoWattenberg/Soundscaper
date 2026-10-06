/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeEncodedAudioExport } from '../src/common/editor/controller/export/internal/audio/audio-realtime-encoded-export.ts';
import { createDesktopAudioCodecRuntime } from '../src/common/editor/desktop-audio-codec-runtime.ts';
import { prepareDirectCompressedDestination } from '../src/common/editor/controller/export/internal/direct/direct-compressed-export.ts';
import { createMediaExportCapabilities, normalizeMediaExportSettings, applyMediaChannelMapping } from '../src/common/editor/media-export.js';
import { FAST_RENDER_THRESHOLDS } from '../src/common/editor/export.js';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import { createWavStreamEncoder } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';
import { writeInterleavedFloat32Pcm } from '../src/common/editor/interleaved-float32-pcm.ts';
import type { WavPcmDescriptor } from '../src/common/editor/wav-pcm-chunk-reader.ts';
import type { DesktopAudioStreamCommand } from '../desktop/desktop-audio-stream-contract.ts';

function fixture(options: { inputSampleRate?: number; customMapping?: boolean; disposeFailure?: Error; staleAfterWrite?: boolean; planDriftAfterWrite?: boolean; provider?: 'bundled' | 'external-ffmpeg' } = {}) {
	const frames = 40000; const inputRate = options.inputSampleRate ?? 48000; const inputFrames = frames * inputRate / 48000; const operationId = `desktop-audio-stream-${'d'.repeat(32)}`;
	const encoded = new Uint8Array(Math.ceil(frames / 1152) * 576);
	for (let offset = 0; offset < encoded.length; offset += 576) encoded.set([0xff, 0xfd, 0xa4, 0], offset);
	let writes = 0; let deletes = 0; let disposed = 0; let rendered = 0; let staging = 0; let stale = false; let confirmations = 0;
	const pcmBytes: Uint8Array[] = [];
	const ffmpeg = createDesktopAudioCodecRuntime({ async capabilities(query) {
		return { schemaVersion: 2, capabilities: query.operations.map((tuple) => ({ ...tuple, available: true, provider: options.provider ?? 'bundled', reason: null })) };
	}, execute() { throw new Error('unexpected full-buffer encode'); }, cancel() {},
		stream(command: DesktopAudioStreamCommand) {
			if (command.type === 'begin') return { operationId };
			if (command.type === 'write') { writes++; pcmBytes.push(command.bytes.slice()); if (options.staleAfterWrite) stale = true; if (options.planDriftAfterWrite) mutatePlan?.(); return { offset: command.offset + command.bytes.length }; }
			if (command.type === 'execute') return { byteLength: encoded.length };
			if (command.type === 'read') return encoded.slice(command.offset, command.offset + command.maximumBytes);
			if (command.type === 'delete') { deletes++; return true; }
			throw new Error('unexpected native command');
		},
	});
	const encoding = normalizeMediaExportSettings('mp2', { capabilities: createMediaExportCapabilities(), inputChannelCount: 2, channelMapping: options.customMapping ? { channels: [{ inputs: [{ channel: 0, gain: 0.25 }, { channel: 1, gain: -0.125 }] }, { inputs: [{ channel: 1, gain: 0.5 }] }] } : 'preserve', sampleRate: 48000, bitRate: 192 });
	const plan = { mode: 'mix', format: 'mp2', container: null, archive: null, mimeType: 'audio/mpeg', sampleRate: 48000, channelCount: 2,
		channelMapping: encoding.channelMapping, encoding, outputFrames: frames, dither: false, ditherMode: 'none', metadata: encoding.metadata, tailFrames: 0,
		outputBytesPerRender: frames * 8, outputFileBytesPerRender: null, requiredTemporaryBytes: frames * 8,
		render: { strategy: 'realtime-stream', fast: false, outputBytes: frames * 8, livePcmBytes: 2 * 1024 ** 3, totalBytes: 2 * 1024 ** 3 + frames * 8, thresholds: FAST_RENDER_THRESHOLDS.desktop, reason: 'total-memory' },
		range: { startFrame: 123, endFrame: 123 + inputFrames, durationFrames: inputFrames },
		outputs: [{ kind: 'mix', fileName: 'mix.mp2', includeMaster: true, respectMuteSolo: true, trackId: null }] };
	const mutatePlan = () => { plan.outputs[0]!.fileName = 'changed.mp2'; };
	const channels = [new Float32Array(inputFrames), new Float32Array(inputFrames)];
	for (let frame = 0; frame < inputFrames; frame++) { channels[0]![frame] = Math.sin(frame / 17); channels[1]![frame] = -channels[0]![frame]!; }
	const reason = new Error('project audio changed');
	const assertCurrent = () => { if (stale) throw reason; };
	const runtime = { createStableId: () => 'test', ffmpeg, applyMediaChannelMapping, createStreamingWindowedSincResampler, copy: { encoding: 'Encoding' },
		setStatus() {}, throwIfAborted(signal: AbortSignal) { if (signal.aborted) throw signal.reason; }, normalizeProjectSampleRate: (rate: number) => rate,
		prepareCommittedTimePitchCaches: async () => undefined, withRenderProgress: (options: object) => options,
		async createTemporaryFileSink() { staging++; throw new Error('unexpected WAV staging'); },
		createWavStreamEncoder() { throw new Error('unexpected WAV encoder'); },
		createCacheAwareRenderEngine() { return { loadProject() {}, async renderMixRealtime(request: { startFrame: number; endFrame: number; preferBoundedOffline?: boolean; onChunk(channels: readonly Float32Array[], metadata: { sampleRate: number }): Promise<void> }) {
			assert.equal(request.startFrame, 123); assert.equal(request.endFrame, 123 + inputFrames); assert.equal(request.preferBoundedOffline, true);
			for (let first = 0; first < inputFrames; first += 128) { rendered++; await request.onChunk(channels.map((channel) => channel.subarray(first, Math.min(first + 128, inputFrames))), { sampleRate: inputRate }); }
		}, async dispose() { disposed++; if (options.disposeFailure) throw options.disposeFailure; } }; },
		options: { async confirmFileSizeWarning() { confirmations++; return true; } },
	};
	const signal = new AbortController().signal;
	return { plan, channels, signal, reason, assertCurrent, async export(destination: Parameters<ReturnType<typeof createRealtimeEncodedAudioExport>>[7] = null) {
		return await createRealtimeEncodedAudioExport(runtime)({ sampleRate: inputRate, masterChannels: 2 }, plan, { includeTail: false }, signal,
			{ sourceMap: new Map(), chunkSources: null, prepareTimePitchCaches: false }, {}, null, destination, assertCurrent);
	}, async exportLegacy() {
		const chunks: Uint8Array<ArrayBuffer>[] = []; const written: Uint8Array[] = [];
		const legacy = { ...runtime, createWavStreamEncoder,
			async createTemporaryFileSink() { return { persistent: true, async write(bytes: Uint8Array) { chunks.push(bytes.slice()); }, async close() { return new Blob(chunks); }, async remove() {}, async abort() {} }; },
			ffmpeg: { async encodeFile(file: Blob) {
				const descriptor = await inspectWavBlobPcm(file) as WavPcmDescriptor;
				await streamWavBlobPcm(file, { descriptor, chunkFrames: 16384, onChunk(packet: readonly Float32Array[]) {
					const mapped = applyMediaChannelMapping(packet, 'preserve'); const bytes = new Uint8Array(mapped[0]!.length * mapped.length * 4);
					writeInterleavedFloat32Pcm(bytes, mapped, { nonFinite: 'preserve' }); written.push(bytes);
				} });
				return { bytes: encoded, mimeType: 'audio/mpeg' };
			} },
		};
		await createRealtimeEncodedAudioExport(legacy)({ sampleRate: inputRate, masterChannels: 2 }, plan, { includeTail: false }, signal,
			{ sourceMap: new Map(), chunkSources: null, prepareTimePitchCaches: false }, {}, null, null, assertCurrent);
		return Buffer.concat(written);
	}, counts: () => ({ writes, deletes, disposed, rendered, staging, confirmations }), pcmBytes };
}

test('realtime desktop compressed export bypasses WAV staging and retains owned output until transferred', async () => {
	const subject = fixture(); const result = await subject.export();
	assert.equal(result.mimeType, 'audio/mpeg'); assert.equal(result.extension, '.mp2'); assert.equal(result.bytes, null);
	assert.deepEqual(subject.counts(), { writes: 3, deletes: 0, disposed: 1, rendered: 313, staging: 0, confirmations: 0 });
	await result.cleanup(); assert.equal(subject.counts().deletes, 1);
});

test('realtime PCM failure stops after its acknowledgement and disposal failure cleans untransferred native output', async () => {
	const stale = fixture({ staleAfterWrite: true });
	await assert.rejects(() => stale.export(), (error: unknown) => error === stale.reason);
	assert.equal(stale.counts().writes, 1); assert.equal(stale.counts().deletes, 1); assert.equal(stale.counts().disposed, 1);
	const error = new Error('render disposal failed'); const cleanup = fixture({ disposeFailure: error });
	await assert.rejects(() => cleanup.export(), (failure: unknown) => failure === error);
	assert.equal(cleanup.counts().deletes, 1);
});

test('direct compressed PCM keeps canonical destination checks and opens only after encoding', async () => {
	const subject = fixture(); let selected = 0; let bytes = 0; let aborted = 0;
	const prepared = await prepareDirectCompressedDestination({ isDesktop: true, async prepareSave() {
		selected++; assert.equal(subject.counts().writes, 3);
		return { mode: 'stream', async createWritable(size: number, mode: string) {
			assert.equal(size, Math.ceil(40000 / 1152) * 576); assert.equal(mode, 'exact');
			return new WritableStream<Uint8Array>({ write(chunk) { bytes += chunk.length; } });
		}, bytesWritten: () => bytes, commit: () => ({ size: bytes }), abort() { aborted++; } };
	} }, subject.plan, {}, subject.signal);
	assert.ok(prepared.destination);
	const result = await subject.export(prepared.destination);
	assert.equal(result.directDestination, prepared.destination); assert.equal(result.byteLength, bytes);
	assert.equal(selected, 1); assert.equal(aborted, 0); assert.equal(subject.counts().deletes, 1); assert.equal(subject.counts().staging, 0);
});

test('unsupported direct PCM capabilities fall back before producing any native input', async () => {
	const subject = fixture({ provider: 'external-ffmpeg' });
	await assert.rejects(() => subject.export(), /unexpected WAV staging/u);
	assert.equal(subject.counts().writes, 0); assert.equal(subject.counts().rendered, 0); assert.equal(subject.counts().staging, 1);
});


test('canonical compressed plan drift after a PCM acknowledgement stops before another packet or save chooser', async () => {
	const subject = fixture({ planDriftAfterWrite: true }); let selected = 0;
	const prepared = await prepareDirectCompressedDestination({ isDesktop: true, prepareSave() { selected++; throw new Error('must not select'); } }, subject.plan, {}, subject.signal);
	assert.ok(prepared.destination);
	await assert.rejects(() => subject.export(prepared.destination), /plan changed/u);
	assert.equal(subject.counts().writes, 1); assert.equal(subject.counts().deletes, 1); assert.equal(selected, 0);
});


test('direct native PCM equals the established realtime WAV carrier after custom mapping and 44.1-to-48 kHz resampling', async () => {
	const subject = fixture({ inputSampleRate: 44100, customMapping: true });
	const reference = await subject.exportLegacy();
	const result = await subject.export();
	assert.deepEqual(Buffer.concat(subject.pcmBytes), reference);
	assert.equal(reference.length, 40000 * 8); await result.cleanup();
});
