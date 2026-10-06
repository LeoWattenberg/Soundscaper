/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createProjectMediaActionGroup } from '../src/common/editor/controller/document/project-media-action-group.ts';
import { prepareManagedAudioConsolidation } from '../src/common/editor/controller/document/internal/native-project/consolidate-managed-audio.ts';
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';
import { crc32, decodePcmWithWavPack, encodePcmAdaptively, loadWavPackWasm, maximumWavPackPayloadBytes, parsePcmContainerIndex, PCM_ENCODING_RAW_F32LE, PCM_ENCODING_WAVPACK_F32_V1, PcmContainerWriter, readPcmContainerPayload, WavPackCodecClient } from '../src/common/editor/wavpack/index.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

async function codec() {
	const runtime = await loadWavPackWasm(await readFile(new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url)));
	return {
		async encode(input: ArrayBuffer, options: Record<string, unknown>) { return encodePcmAdaptively(input, { ...options, runtime }); },
		async decode(input: ArrayBuffer, options: Record<string, unknown>) { return { payload: decodePcmWithWavPack(input, { ...options, runtime }) }; },
	};
}

test('explicit consolidation WavPack bypasses optional savings while preserving packet capacity', async () => {
	const pcm = new PcmRepository({ codec: await codec() });
	pcm.setOptimizationMode('speed');
	const input = new Float32Array(1_024).fill(0.25).buffer;
	const options = { frames: 1_024, channelCount: 1, sampleRate: 48_000, priority: 'migration', allowRawOnFailure: true };
	assert.equal((await pcm.encode(input, options)).encoding, PCM_ENCODING_RAW_F32LE);
	const compressed = await pcm.encode(input, { ...options, requireWavPack: true });
	assert.equal(compressed.encoding, PCM_ENCODING_WAVPACK_F32_V1);
	assert.ok(compressed.payload.byteLength <= input.byteLength);
	assert.deepEqual(new Uint32Array((await pcm.decodeRecord({ ...compressed, index: 0, frames: 1_024 }, {
		channelCount: 1, sampleRate: 48_000,
	})).channels[0].buffer), new Uint32Array(input));
	const tiny = await pcm.encode(Float32Array.of(0).buffer, { ...options, frames: 1, requireWavPack: true });
	assert.equal(tiny.encoding, PCM_ENCODING_WAVPACK_F32_V1);
	assert.ok(tiny.payload.byteLength > 4);
	assert.ok(tiny.payload.byteLength <= maximumWavPackPayloadBytes(1, 1));
	assert.equal((await pcm.decodeRecord({ ...tiny, index: 0, frames: 1 }, { channelCount: 1, sampleRate: 48_000 })).channels[0][0], 0);
});

test('required WavPack rejects changed decode bits before source publication', async (context) => {
	const direct = await codec();
	context.mock.method(direct, 'decode', async (input: ArrayBuffer, options: Record<string, unknown>) => {
		const result = await codec().then((fresh) => fresh.decode(input, options));
		new Uint8Array(result.payload)[0] ^= 1;
		return result;
	});
	const pcm = new PcmRepository({ codec: direct });
	await assert.rejects(pcm.encode(new Float32Array(1_024).buffer, {
		frames: 1_024, channelCount: 1, sampleRate: 48_000, priority: 'migration',
		allowRawOnFailure: true, requireWavPack: true,
	}), /exact source sample bits/iu);
});

test('expanded WavPack packet admission rejects every byte beyond its finite geometry budget', async () => {
	const frames = 1, channelCount = 1, sampleRate = 48_000;
	const maximumBytes = maximumWavPackPayloadBytes(frames, channelCount);
	const oversized = new ArrayBuffer(maximumBytes + 1);
	const runtime = await loadWavPackWasm(await readFile(new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url)));
	assert.throws(() => runtime.encode(new ArrayBuffer(4), { frames, channelCount, sampleRate, maximumOutputBytes: maximumBytes + 1 }), /bounded/iu);
	assert.throws(() => runtime.decode(oversized, { frames, channelCount, sampleRate }), /bounded/iu);
	const client = new WavPackCodecClient({ workerFactory: () => { throw new Error('Oversize must fail before dispatch.'); } });
	assert.throws(() => client.decode(oversized, { encoding: PCM_ENCODING_WAVPACK_F32_V1, frames, channelCount, sampleRate }), /bounded/iu);
	client.close();
	const pcm = new PcmRepository({ codec: {
		async encode(raw: ArrayBuffer) { return { encoding: PCM_ENCODING_WAVPACK_F32_V1, payload: oversized, pcmCrc32: crc32(raw) }; },
		async decode() { throw new Error('Oversize must fail before decode.'); },
	} });
	await assert.rejects(pcm.encode(new ArrayBuffer(4), { frames, channelCount, sampleRate, priority: 'migration', requireWavPack: true,
		allowRawOnFailure: true }), /capacity/iu);
	await assert.rejects(pcm.decodeRecord({ index: 0, frames, encoding: PCM_ENCODING_WAVPACK_F32_V1,
		payload: oversized, pcmCrc32: 0 }, { channelCount, sampleRate }), /bounded/iu);
	const writer = new PcmContainerWriter({ async write() {}, async close() {} }, { channelCount, sampleRate, chunkFrames: frames });
	await assert.rejects(writer.write({ frames, payload: oversized, encoding: PCM_ENCODING_WAVPACK_F32_V1, pcmCrc32: 0 }), /bounded/iu);
});

test('expanded WavPack packets roundtrip through the unchanged version-one container index', async () => {
	const pcm = new PcmRepository({ codec: await codec() });
	const input = Float32Array.of(-0).buffer;
	const encoded = await pcm.encode(input, { frames: 1, channelCount: 1, sampleRate: 48_000, priority: 'migration',
		requireWavPack: true, allowRawOnFailure: false });
	const parts: ArrayBuffer[] = [];
	const writer = new PcmContainerWriter({
		async write(input: ArrayBuffer | ArrayBufferView<ArrayBuffer>) {
			const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
			parts.push(bytes.slice().buffer);
		}, async close() {},
	}, { channelCount: 1, sampleRate: 48_000, chunkFrames: 1 });
	await writer.write({ ...encoded, frames: 1 });
	const statistics = await writer.close();
	assert.equal(statistics.storedBytes, encoded.payload.byteLength);
	assert.ok(statistics.storedBytes > statistics.uncompressedBytes);
	const file = new Blob(parts);
	const index = await parsePcmContainerIndex(file);
	assert.equal(index.entries[0].length, encoded.payload.byteLength);
	const payload = await readPcmContainerPayload(file, index.entries[0]);
	const chunk = await pcm.decodeRecord({ ...encoded, payload, index: 0, frames: 1 }, { channelCount: 1, sampleRate: 48_000 });
	assert.deepEqual(new Uint32Array(chunk.channels[0].buffer), new Uint32Array(input));
	const forgedLength = maximumWavPackPayloadBytes(1, 1) + 1;
	const indexBytes = new Uint8Array(await file.slice(index.indexOffset, index.indexOffset + 24).arrayBuffer());
	new DataView(indexBytes.buffer).setUint32(8, forgedLength, true);
	const footer = new Uint8Array(await file.slice(file.size - 32).arrayBuffer());
	const footerView = new DataView(footer.buffer);
	footerView.setBigUint64(16, BigInt(32 + forgedLength), true);
	footerView.setUint32(24, crc32(indexBytes), true);
	footerView.setUint32(28, crc32(footer.subarray(0, 28)), true);
	const forged = new Blob([await file.slice(0, 32).arrayBuffer(), new ArrayBuffer(forgedLength), indexBytes, footer]);
	await assert.rejects(parsePcmContainerIndex(forged), /index entry/iu);
});

test('Consolidate media converts Speed raw PCM into a fresh verified WavPack source and undo keeps raw PCM', async (context) => {
	const store = createProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false,
		memoryFallback: false, databaseName: `consolidate-speed-${crypto.randomUUID()}`, pcmCodec: await codec() });
	context.after(async () => { await store.close(); });
	store.setPcmOptimizationMode('speed');
	const writer = await store.beginSourceWrite('raw', { sampleRate: 48_000, channelCount: 1, chunkFrames: 1_024 });
	await writer.write([new Float32Array(1_024).fill(0.25)]);
	await writer.write([new Float32Array(1_024).fill(-0.5)]);
	const raw = await writer.commit();
	assert.equal(raw.rawChunkCount, 2);
	let history = createEditorHistory(project());
	let saves = 0;
	const group = createProjectMediaActionGroup({ state: {}, store, getProject: () => history.present,
		commit: (command) => { history = executeEditorCommand(history, command); },
		saveScape: async () => { saves += 1; return {}; },
	});
	const result = await group.consolidate();
	assert.ok(result?.run.report.items.some((item) => item.code === 'consolidate.pcm-wavpack'));
	assert.equal(saves, 1);
	const key = history.present.sources[0].storageKey;
	assert.notEqual(key, 'raw');
	const compressed = await store.getSourceMetadata(key);
	assert.equal(compressed?.rawChunkCount, 0);
	assert.equal(compressed?.wavpackChunkCount, 2);
	assert.equal((await store.getSourceMetadata('raw'))?.sourceToken, raw.sourceToken);
	assert.equal((await store.readSourceChunk(key, 0))?.channels[0][0], 0.25);
	assert.equal((await store.readSourceChunk(key, 1))?.channels[0][0], -0.5);
	assert.equal(history.present.clips[0].sourceStartFrame, 128);
	assert.equal(history.present.projectBin.clips[0].sourceStartFrame, 1_100);
	history = undoEditorCommand(history);
	assert.equal(history.present.sources[0].storageKey, 'raw');
	assert.equal((await store.readSourceChunk('raw', 0))?.channels[0][0], 0.25);
	const foreground = await store.beginSourceWrite('still-speed', { sampleRate: 48_000 });
	await foreground.write([new Float32Array(1_024)]);
	assert.equal((await foreground.commit()).rawChunkCount, 1, 'Consolidation must not change the global Speed preference.');
});

test('failed consolidation binding discards only the new physical source', async (context) => {
	const store = createProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false,
		memoryFallback: false, databaseName: `consolidate-fence-${crypto.randomUUID()}`, pcmCodec: await codec() });
	context.after(async () => { await store.close(); });
	store.setPcmOptimizationMode('speed');
	const writer = await store.beginSourceWrite('raw', { sampleRate: 48_000, channelCount: 1, chunkFrames: 1_024 });
	await writer.write([new Float32Array(1_024)]);
	await writer.write([new Float32Array(1_024)]);
	await writer.commit();
	const state: { deliveryReport?: unknown } = {};
	const statuses: string[] = [];
	await assert.rejects(createProjectMediaActionGroup({ state, store, getProject: () => project(),
		setStatus: (message) => { statuses.push(message); },
		commit: () => { throw new Error('Binding was refused.'); },
	}).consolidate(), /Binding was refused/u);
	assert.match(JSON.stringify(state.deliveryReport), /consolidate.pcm-conversion-failed/u);
	assert.equal(statuses.at(-1), 'Some media could not be consolidated.');
	assert.deepEqual((await store.listSources()).map((source) => source.id), ['raw']);
	const controller = new AbortController();
	controller.abort(new DOMException('Cancelled conversion.', 'AbortError'));
	await assert.rejects(prepareManagedAudioConsolidation(project(), store, () => {}, controller.signal), { name: 'AbortError' });
	assert.deepEqual((await store.listSources()).map((source) => source.id), ['raw']);
});

test('cancelled WavPack conversion retires the unpublished stage and preserves the raw generation', async (context) => {
	const direct = await codec(), controller = new AbortController();
	const originalEncode = direct.encode;
	context.mock.method(direct, 'encode', async (input: ArrayBuffer, options: Record<string, unknown>) => {
		const result = await originalEncode(input, options);
		controller.abort(new DOMException('Cancelled conversion.', 'AbortError'));
		return result;
	});
	const store = createProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false,
		memoryFallback: false, databaseName: `consolidate-abort-${crypto.randomUUID()}`, pcmCodec: direct });
	context.after(async () => { await store.close(); });
	store.setPcmOptimizationMode('speed');
	const writer = await store.beginSourceWrite('raw', { sampleRate: 48_000, channelCount: 1, chunkFrames: 1_024 });
	await writer.write([new Float32Array(1_024)]);
	await writer.write([new Float32Array(1_024)]);
	const raw = await writer.commit();
	await assert.rejects(prepareManagedAudioConsolidation(project(), store, () => {}, controller.signal), { name: 'AbortError' });
	assert.deepEqual((await store.listSources()).map((source) => source.id), ['raw']);
	assert.equal((await store.getSourceMetadata('raw'))?.sourceToken, raw.sourceToken);
	assert.equal((await store.readSourceChunk('raw', 1))?.channels[0][0], 0);
});

function project() {
	return createCurrentAudioEditorProject({ id: 'consolidate-project', now: '2026-10-06T12:00:00Z', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', storageKey: 'raw', name: 'Take', frameCount: 2_048, channelCount: 1, sampleRate: 48_000 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', sourceStartFrame: 128, sourceDurationFrames: 512, durationFrames: 512 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
		projectBin: { clips: [createAudioClip({ id: 'bin', sourceId: 'source', sourceStartFrame: 1_100,
			sourceDurationFrames: 512, durationFrames: 512 })] },
	});
}
