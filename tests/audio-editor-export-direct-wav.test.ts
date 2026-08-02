/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_DESKTOP_SAVE_BYTES } from '../desktop/constants.js';
import { createEditorExportService } from '../src/common/editor/controller/export-service.ts';
import {
	DIRECT_PCM_DESTINATION_WRITE_BYTES, DIRECT_PCM_MAXIMUM_PENDING_BYTES, DIRECT_PCM_RENDER_CHUNK_FRAMES,
	createDirectPcmEncoder, directPcmMaximumPendingChunks, openDirectPcmDestination,
} from '../src/common/editor/controller/direct-pcm-export.ts';
import { DIRECT_WAV_MAXIMUM_FILE_BYTES, prepareDirectWavDestination } from '../src/common/editor/controller/direct-wav-export.ts';
import type { IxmlMetadataInput } from '../src/common/editor/ixml.ts';
import type { RiffMarkerInput } from '../src/common/editor/riff-markers.ts';
import { inspectWavLayout } from '../src/common/editor/wav.js';
import {
	createDirectPcmExportFixture, createPreparedStream, deferred, directPlan,
	type DirectExportFixtureOptions, type TestPlan,
} from './helpers/direct-pcm-export-fixture.ts';

interface WavEncoding extends Readonly<Record<string, unknown>> {
	bitDepth: 16 | 20 | 24 | 32;
	floatingPoint: boolean;
	sampleFormat: 'int16' | 'int20' | 'int24' | 'int32' | 'float32';
}

interface WavPlan extends TestPlan {
	cart: null;
	encoding: WavEncoding;
	ixml: IxmlMetadataInput | null;
	markers: readonly RiffMarkerInput[];
	metadata: Readonly<Record<string, unknown>>;
	outputFileBytesPerRender: number;
}

function directWavPlan(overrides: Readonly<Record<string, unknown>> = {}): WavPlan {
	const plan = {
		...directPlan(),
		cart: null,
		encoding: Object.freeze({ bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' }),
		ixml: null,
		markers: Object.freeze([]),
		metadata: Object.freeze({}),
		...overrides,
	} as WavPlan;
	if (Object.hasOwn(overrides, 'outputFileBytesPerRender')) return plan;
	return { ...plan, outputFileBytesPerRender: wavLayout(plan).byteLength };
}

function exactDirectWavPlan(overrides: Readonly<Record<string, unknown>> = {}): WavPlan {
	const plan = directWavPlan(overrides);
	return { ...plan, outputFileBytesPerRender: wavLayout(plan).byteLength };
}

function wavLayout(plan: WavPlan): ReturnType<typeof inspectWavLayout> {
	return inspectWavLayout({
		container: 'auto',
		sampleRate: plan.sampleRate,
		channelCount: plan.channelCount,
		totalFrames: plan.outputFrames,
		bitDepth: plan.encoding.bitDepth,
		float: plan.encoding.floatingPoint,
		metadata: plan.metadata,
		markers: plan.markers,
		ixml: plan.ixml,
	});
}

function createFixture(
	plan: WavPlan = directWavPlan(),
	options: DirectExportFixtureOptions = {},
) {
	return createDirectPcmExportFixture(plan, {
		encoderFinalByteLength: plan.outputFileBytesPerRender,
		encoderInitialChunks: [new Uint8Array(plan.outputFileBytesPerRender - 3)],
		...options,
	});
}

test('direct PCM encoder coalesces bounded container writes and awaits each destination flush', async () => {
	assert.equal(DIRECT_PCM_DESTINATION_WRITE_BYTES, 4 * 1024 * 1024);
	const half = DIRECT_PCM_DESTINATION_WRITE_BYTES / 2;
	const releaseWrite = deferred();
	const writeStarted = deferred();
	const writes: Uint8Array[] = [];
	let closed = false;
	let encoderOnChunk: ((chunk: Uint8Array) => void) | null = null;
	let block = 0;
	const encoder = await createDirectPcmEncoder({
		async write(chunk) {
			writes.push(chunk.slice());
			if (chunk.byteLength === DIRECT_PCM_DESTINATION_WRITE_BYTES) {
				writeStarted.resolve();
				await releaseWrite.promise;
			}
		},
		async close() { closed = true; },
		async abort() {},
		bytesWritten: () => writes.reduce((total, chunk) => total + chunk.byteLength, 0),
		async commit() { return {}; },
	}, (options) => {
		encoderOnChunk = options.onChunk as (chunk: Uint8Array) => void;
		encoderOnChunk(Uint8Array.of(0));
		return {
			write() {
				block += 1;
				encoderOnChunk?.(new Uint8Array(half).fill(block));
			},
			finalize() { return { byteLength: 1 + 2 * half }; },
		};
	}, {}, 'WAV');

	assert.deepEqual(writes.map((chunk) => chunk.byteLength), [1]);
	await encoder.write([Float32Array.of(0)]);
	assert.deepEqual(writes.map((chunk) => chunk.byteLength), [1]);
	let secondSettled = false;
	const second = encoder.write([Float32Array.of(0)]).then(() => { secondSettled = true; });
	await writeStarted.promise;
	assert.equal(secondSettled, false);
	assert.deepEqual(writes.map((chunk) => chunk.byteLength), [1, DIRECT_PCM_DESTINATION_WRITE_BYTES]);
	releaseWrite.resolve();
	await second;
	assert.equal(await encoder.finalize(), 1 + 2 * half);
	assert.equal(closed, true);
});

test('direct PCM destination memoizes a synchronously throwing prepared abort', async () => {
	const cleanup = new Error('synchronous PCM cleanup failed');
	let aborts = 0;
	const preparation = await openDirectPcmDestination({
		mode: 'stream',
		async createWritable() { return new WritableStream<Uint8Array>(); },
		bytesWritten() { return 0; },
		async commit() { return {}; },
		abort() { aborts += 1; throw cleanup; },
	}, 4, 'WAV');
	assert.ok(preparation.destination);
	const reason = new Error('PCM output failed');

	for (let attempt = 0; attempt < 2; attempt += 1) {
		await assert.rejects(
			Promise.resolve().then(() => preparation.destination!.abort(reason)),
			cleanup,
		);
	}
	assert.equal(aborts, 1);
	await assert.rejects(preparation.destination.write(Uint8Array.of(1)), /not writable/iu);
});

test('exact realtime WAV mixes await coalesced destination writes and publish no Blob', async () => {
	const plan = directWavPlan();
	const fixture = createFixture(plan);
	const writeStarted = deferred();
	const releaseWrite = deferred();
	const destination = createPreparedStream({
		onWrite: async (chunk) => {
			if (chunk[0] !== 1) return;
			writeStarted.resolve();
			await releaseWrite.promise;
		},
	});
	fixture.setPrepared(destination.prepared);
	const saving = createEditorExportService(fixture.runtime).handleExportAction('export', {
		saveTarget: { id: 'target' },
		useFileSystemAccess: true,
	});

	await writeStarted.promise;
	assert.deepEqual(fixture.calls, [
		'render:chunk:1', 'encoder:write:1',
		'render:chunk:2', 'encoder:write:2',
		'render:done',
	]);
	assert.equal(destination.commitCalls(), 0);
	releaseWrite.resolve();
	const result = await saving;

	assert.deepEqual(destination.admissions, [[plan.outputFileBytesPerRender, 'exact']]);
	assert.deepEqual(destination.chunks.map((chunk) => chunk.byteLength), [plan.outputFileBytesPerRender - 3, 3]);
	assert.deepEqual([...destination.chunks[1]], [1, 2, 3]);
	assert.equal(destination.commitCalls(), 1);
	assert.equal(destination.abortCalls(), 0);
	assert.equal(fixture.downloads.length, 0);
	assert.deepEqual(fixture.preflights, []);
	assert.equal(fixture.calls.includes('temporary:create'), false);
	assert.equal(fixture.renderRequests[0].chunkFrames, DIRECT_PCM_RENDER_CHUNK_FRAMES);
	assert.equal(fixture.renderRequests[0].maximumPendingChunks, directPcmMaximumPendingChunks(2));
	assert.deepEqual(fixture.prepareRequests.map((request) => ({
		purpose: request.purpose,
		suggestedName: request.suggestedName,
		mimeType: request.mimeType,
		target: request.target,
		types: request.types,
		useFileSystemAccess: request.useFileSystemAccess,
	})), [{
		purpose: 'audio-pcm-mix', suggestedName: 'mix.wav', mimeType: 'audio/wav',
		target: { id: 'target' },
		types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }],
		useFileSystemAccess: true,
	}]);
	assert.deepEqual(result, {
		url: null,
		fileName: 'direct.wav',
		mimeType: 'audio/wav',
		size: plan.outputFileBytesPerRender,
		method: 'file-system-access',
	});
	assert.equal(fixture.state.outputUrl, null);
});

test('direct WAV resamples before a selection-only channel expansion', async () => {
	const mapping = {
		inputChannelCount: 2,
		outputChannelCount: 16,
		mode: 'custom',
		channels: Array.from({ length: 16 }, () => ({ inputs: [{ channel: 0, gain: 1 }] })),
	};
	const fixture = createFixture(directWavPlan({ channelCount: 16, channelMapping: mapping }));
	const destination = createPreparedStream();
	fixture.setPrepared(destination.prepared);
	await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.deepEqual(fixture.resamplerChannelCounts, [2]);
});
test('direct WAV pending PCM capacity is byte-bounded across render channel counts', () => {
	assert.equal(DIRECT_PCM_RENDER_CHUNK_FRAMES, 16_384);
	assert.equal(DIRECT_PCM_MAXIMUM_PENDING_BYTES, 32 * 1024 ** 2);
	assert.equal(directPcmMaximumPendingChunks(1), 512);
	assert.equal(directPcmMaximumPendingChunks(2), 256);
	assert.equal(directPcmMaximumPendingChunks(16), 32);
	assert.equal(directPcmMaximumPendingChunks(32), 16);
	for (let channels = 1; channels <= 32; channels += 1) {
		const retainedBytes = directPcmMaximumPendingChunks(channels)
			* DIRECT_PCM_RENDER_CHUNK_FRAMES * channels * Float32Array.BYTES_PER_ELEMENT;
		assert.ok(retainedBytes <= DIRECT_PCM_MAXIMUM_PENDING_BYTES);
	}
	for (const invalid of [0, 1.5, 33, Number.NaN]) {
		assert.throws(() => directPcmMaximumPendingChunks(invalid), /channel count/iu);
	}
});

test('direct WAV admission rejects malformed or stale classic layout geometry before target selection', async () => {
	assert.equal(DIRECT_WAV_MAXIMUM_FILE_BYTES, MAX_DESKTOP_SAVE_BYTES);
	const valid = directWavPlan();
	const incorrectlyAdmitted: string[] = [];
	for (const [label, candidate] of [
		['wrong format', { ...valid, format: 'bwf' }],
		['BW64 format', { ...valid, format: 'bw64' }],
		['AIFF format', { ...valid, format: 'aiff' }],
		['wrong MIME type', { ...valid, mimeType: 'audio/x-wav' }],
		['stems', { ...valid, mode: 'stems' }],
		['multiple outputs', { ...valid, outputs: [
			...valid.outputs, { fileName: 'other.wav', trackId: 'other' },
		] }],
		['wrong extension', { ...valid, outputs: [{ fileName: 'mix.wave', trackId: 'track' }] }],
		['missing byte count', { ...valid, outputFileBytesPerRender: null }],
		['zero byte count', { ...valid, outputFileBytesPerRender: 0 }],
		['fractional byte count', { ...valid, outputFileBytesPerRender: 1.5 }],
		['unsafe byte count', { ...valid, outputFileBytesPerRender: Number.MAX_SAFE_INTEGER + 1 }],
		['over-limit byte count', { ...valid, outputFileBytesPerRender: DIRECT_WAV_MAXIMUM_FILE_BYTES + 1 }],
		['layout byte-count mismatch', { ...valid, outputFileBytesPerRender: valid.outputFileBytesPerRender + 2 }],
		['offline render', { ...valid, render: { strategy: 'offline' } }],
		['explicit auto container', { ...valid, container: 'auto' }],
		['explicit BW64 container', { ...valid, container: 'bw64' }],
		['explicit BEXT', { ...valid, bext: { description: 'forged' } }],
		['explicit null BEXT', { ...valid, bext: null }],
		['ADM', { ...valid, adm: { mode: 'authored' } }],
		['pre-data chunks', { ...valid, preDataChunks: new Uint8Array([1]) }],
		['trailing chunks', { ...valid, trailingChunks: new Uint8Array([2]) }],
		['missing CART', { ...valid, cart: undefined }],
		['classic CART metadata', { ...valid, cart: { title: 'Ignored by the classic writer' } }],
		['missing sample rate', { ...valid, sampleRate: undefined }],
		['zero sample rate', { ...valid, sampleRate: 0 }],
		['string sample rate', { ...valid, sampleRate: '48000' }],
		['fractional sample rate', { ...valid, sampleRate: 48_000.5 }],
		['unsafe sample rate', { ...valid, sampleRate: Number.MAX_SAFE_INTEGER + 1 }],
		['over-field sample rate', { ...valid, sampleRate: 0x1_0000_0000 }],
		['missing channel count', { ...valid, channelCount: undefined }],
		['zero channel count', { ...valid, channelCount: 0 }],
		['string channel count', { ...valid, channelCount: '2' }],
		['fractional channel count', { ...valid, channelCount: 1.5 }],
		['over-limit channel count', { ...valid, channelCount: 33 }],
		['stale channel geometry', { ...valid, channelCount: 1 }],
		['missing output frames', { ...valid, outputFrames: undefined }],
		['string output frames', { ...valid, outputFrames: '2' }],
		['fractional output frames', { ...valid, outputFrames: 1.5 }],
		['negative output frames', { ...valid, outputFrames: -1 }],
		['unsafe output frames', { ...valid, outputFrames: Number.MAX_SAFE_INTEGER + 1 }],
		['stale frame geometry', { ...valid, outputFrames: valid.outputFrames + 1 }],
		['missing encoding', { ...valid, encoding: undefined }],
		['null encoding', { ...valid, encoding: null }],
		['string encoding', { ...valid, encoding: 'int24' }],
		['array encoding', { ...valid, encoding: [] }],
		['decorated array encoding', { ...valid, encoding: Object.assign([], {
			bitDepth: 24, floatingPoint: false, sampleFormat: 'int24',
		}) }],
		['missing bit depth', { ...valid, encoding: {
			floatingPoint: false, sampleFormat: 'int24',
		} }],
		['missing floating-point flag', { ...valid, encoding: {
			bitDepth: 24, sampleFormat: 'int24',
		} }],
		['missing sample format', { ...valid, encoding: {
			bitDepth: 24, floatingPoint: false,
		} }],
		['unsupported integer-32', { ...valid, encoding: {
			bitDepth: 32, floatingPoint: false, sampleFormat: 'int32',
		} }],
		['bit-depth mismatch', { ...valid, encoding: {
			bitDepth: 16, floatingPoint: false, sampleFormat: 'int24',
		} }],
		['floating-point mismatch', { ...valid, encoding: {
			bitDepth: 24, floatingPoint: true, sampleFormat: 'int24',
		} }],
		['float-32 integer mismatch', { ...valid, encoding: {
			bitDepth: 32, floatingPoint: false, sampleFormat: 'float32',
		} }],
		['stale sample format', { ...valid, encoding: {
			bitDepth: 16, floatingPoint: false, sampleFormat: 'int16',
		} }],
		['missing metadata', { ...valid, metadata: undefined }],
		['null metadata', { ...valid, metadata: null }],
		['string metadata', { ...valid, metadata: 'forged' }],
		['array metadata', { ...valid, metadata: [] }],
		['decorated array metadata', { ...valid, metadata: Object.assign([], { title: 'forged' }) }],
		['malformed metadata', { ...valid, metadata: { title: '\u0001' } }],
		['stale metadata geometry', { ...valid, metadata: { title: 'Changed' } }],
		['missing markers', { ...valid, markers: undefined }],
		['object markers', { ...valid, markers: {} }],
		['invalid marker geometry', { ...valid, markers: [{ sampleOffset: -1 }] }],
		['stale marker geometry', { ...valid, markers: [{ id: 1, sampleOffset: 0, label: 'Start' }] }],
		['missing iXML', { ...valid, ixml: undefined }],
		['string iXML', { ...valid, ixml: 'forged' }],
		['array iXML', { ...valid, ixml: [] }],
		['decorated array iXML', { ...valid, ixml: Object.assign([], { project: 'forged' }) }],
		['invalid iXML geometry', { ...valid, ixml: { tracks: [{ channelIndex: 0 }] } }],
		['stale iXML geometry', { ...valid, ixml: { project: 'Changed' } }],
	] satisfies Array<readonly [string, Readonly<Record<string, unknown>>]>) {
		let prepareCalls = 0;
		const preparation = await prepareDirectWavDestination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, candidate as Parameters<typeof prepareDirectWavDestination>[1], {}, new AbortController().signal);
		if (prepareCalls !== 0) incorrectlyAdmitted.push(label);
		assert.deepEqual(preparation, { cancelled: null, destination: null });
	}
	assert.deepEqual(incorrectlyAdmitted, []);
});

test('direct WAV admission accepts exact canonical, metadata-rich, RIFF, RF64, and 65 GiB layouts', async () => {
	for (const encoding of [
		Object.freeze({ bitDepth: 16, floatingPoint: false, sampleFormat: 'int16' }),
		Object.freeze({ bitDepth: 20, floatingPoint: false, sampleFormat: 'int20' }),
		Object.freeze({ bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' }),
		Object.freeze({ bitDepth: 32, floatingPoint: true, sampleFormat: 'float32' }),
	] as const) {
		const plan = directWavPlan({ encoding });
		let prepareCalls = 0;
		await prepareDirectWavDestination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, plan, {}, new AbortController().signal);
		assert.equal(prepareCalls, 1, encoding.sampleFormat);
	}

	const richPlan = directWavPlan({
		channelCount: 1,
		encoding: Object.freeze({ bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' }),
		ixml: Object.freeze({ project: 'Exact classic WAV' }),
		markers: Object.freeze([{ id: 1, sampleOffset: 0, label: 'Start' }]),
		metadata: Object.freeze({ title: 'Exact classic WAV' }),
		outputFrames: 1,
	});
	const richLayout = wavLayout(richPlan);
	assert.equal(richLayout.container, 'riff');
	assert.equal(richLayout.dataByteLength, 3);
	assert.equal(richLayout.dataPadByteLength, 1);
	assert.ok(richLayout.trailingByteLength > 0);
	let richPrepareCalls = 0;
	await prepareDirectWavDestination({
		prepareSave() {
			richPrepareCalls += 1;
			return Object.freeze({ mode: 'blob' });
		},
	}, richPlan, {}, new AbortController().signal);
	assert.equal(richPrepareCalls, 1);

	const riffMaximum = directWavPlan({
		channelCount: 1,
		encoding: Object.freeze({ bitDepth: 16, floatingPoint: false, sampleFormat: 'int16' }),
		outputFrames: 2_147_483_629,
	});
	const riffLayout = wavLayout(riffMaximum);
	assert.equal(riffLayout.container, 'riff');
	assert.equal(riffLayout.riffSize, 0xffff_fffe);
	assert.equal(riffLayout.byteLength, 4_294_967_302);
	assert.equal(riffLayout.dataPadByteLength, 0);
	const firstRf64 = exactDirectWavPlan({ ...riffMaximum, outputFrames: riffMaximum.outputFrames + 1 });
	const rf64Layout = wavLayout(firstRf64);
	assert.equal(rf64Layout.container, 'rf64');
	assert.equal(rf64Layout.headerByteLength, 80);
	assert.equal(rf64Layout.byteLength, 4_294_967_340);
	for (const plan of [riffMaximum, firstRf64]) {
		let prepareCalls = 0;
		await prepareDirectWavDestination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, plan, {}, new AbortController().signal);
		assert.equal(prepareCalls, 1, wavLayout(plan).container);
	}

	const maximumPlan = directWavPlan({
		channelCount: 1,
		encoding: Object.freeze({ bitDepth: 16, floatingPoint: false, sampleFormat: 'int16' }),
		outputFrames: 34_896_609_240,
		outputs: [{ fileName: 'MIX.WAV', trackId: 'track' }],
	});
	const maximumLayout = wavLayout(maximumPlan);
	assert.equal(maximumLayout.container, 'rf64');
	assert.equal(maximumLayout.headerByteLength, 80);
	assert.equal(maximumLayout.byteLength, DIRECT_WAV_MAXIMUM_FILE_BYTES);
	const nextPlan = exactDirectWavPlan({ ...maximumPlan, outputFrames: maximumPlan.outputFrames + 1 });
	const nextLayout = wavLayout(nextPlan);
	assert.equal(nextLayout.byteLength, DIRECT_WAV_MAXIMUM_FILE_BYTES + 2);

	const destination = createPreparedStream();
	const preparation = await prepareDirectWavDestination({
		prepareSave() { return destination.prepared; },
	}, maximumPlan, {}, new AbortController().signal);
	assert.deepEqual(destination.admissions, [[maximumLayout.byteLength, 'exact']]);
	assert.ok(preparation.destination);
	await preparation.destination.abort();
	assert.equal(destination.abortCalls(), 1);
	let nextPrepareCalls = 0;
	const nextPreparation = await prepareDirectWavDestination({
		prepareSave() {
			nextPrepareCalls += 1;
			return Object.freeze({ mode: 'blob' });
		},
	}, nextPlan, {}, new AbortController().signal);
	assert.equal(nextPrepareCalls, 0);
	assert.deepEqual(nextPreparation, { cancelled: null, destination: null });
});

test('classic WAV keeps the existing Blob fallback when no exact stream destination opens', async () => {
	const fallback = createFixture();
	const result = await createEditorExportService(fallback.runtime).handleExportAction('export');
	assert.equal(fallback.prepareRequests.length, 1);
	assert.equal(fallback.calls.includes('temporary:create'), true);
	assert.equal(fallback.downloads.length, 1);
	assert.deepEqual(fallback.preflights, [64]);
	assert.equal(result.url, 'blob:fallback');
});

test('direct WAV cancellation avoids rendering and write or commit failures abort exactly once', async () => {
	const cancelled = createFixture();
	cancelled.setPrepared(Object.freeze({ mode: 'cancelled', cancelled: true, fileName: 'mix.wav' }));
	const cancelledResult = await createEditorExportService(cancelled.runtime).handleExportAction('export');
	assert.equal(cancelledResult.cancelled, true);
	assert.equal(cancelled.calls.includes('render:chunk:1'), false);
	assert.deepEqual(cancelled.preflights, []);

	for (const [label, destination] of [
		['write', createPreparedStream({ writeErrorByte: 1 })],
		['commit', createPreparedStream({ commitError: new Error('direct WAV commit failed') })],
	] as const) {
		const fixture = createFixture();
		fixture.setPrepared(destination.prepared);
		assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export'), undefined);
		assert.equal(destination.abortCalls(), 1, `${label} failure abort count`);
		assert.equal(destination.commitCalls(), label === 'commit' ? 1 : 0);
		assert.equal(fixture.downloads.length, 0);
		assert.match((fixture.errors[0] as Error).message, new RegExp(`direct WAV ${label} failed`, 'iu'));
	}
});

test('direct WAV publication requires plan, encoder, destination, and committed sizes to agree', async () => {
	for (const [label, fixture, destination, expectedCommitCalls, expectedAbortCalls] of [
		[
			'encoder', createFixture(directWavPlan(), { encoderFinalByteLength: 3 }),
			createPreparedStream(), 0, 1,
		],
		[
			'destination', createFixture(),
			createPreparedStream({ reportedByteLength: 3 }), 0, 1,
		],
		[
			'committed', createFixture(),
			createPreparedStream({ publishedSize: 3 }), 1, 0,
		],
	] as const) {
		fixture.setPrepared(destination.prepared);
		assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export'), undefined);
		assert.equal(destination.commitCalls(), expectedCommitCalls, `${label} commit count`);
		assert.equal(destination.abortCalls(), expectedAbortCalls, `${label} abort count`);
		assert.match((fixture.errors[0] as Error).message, new RegExp(label, 'iu'));
		assert.equal(fixture.state.exportOutput, null);
	}
});

test('cancellation during prior output cleanup prevents a stale direct commit', async () => {
	const cleanupStarted = deferred();
	const releaseCleanup = deferred();
	const destination = createPreparedStream();
	const fixture = createFixture();
	fixture.state.exportOutput = Object.freeze({ fileName: 'previous.wav' });
	fixture.state.outputCleanup = async () => {
		cleanupStarted.resolve();
		await releaseCleanup.promise;
	};
	fixture.setPrepared(destination.prepared);
	const service = createEditorExportService(fixture.runtime);
	const saving = service.handleExportAction('export');

	await cleanupStarted.promise;
	await service.handleExportAction('cancel');
	const snapshotsAfterCancellation = fixture.snapshots();
	releaseCleanup.resolve();
	assert.equal(await saving, undefined);

	assert.equal(destination.commitCalls(), 0);
	assert.equal(destination.abortCalls(), 1);
	assert.equal(fixture.state.exportOutput, null);
	assert.equal(fixture.statuses.includes('Done'), false);
	assert.equal(fixture.snapshots(), snapshotsAfterCancellation);
});

test('cancellation during direct commit returns the saved file without stale success publication', async () => {
	const commitStarted = deferred();
	const releaseCommit = deferred();
	const destination = createPreparedStream({
		onCommit: async () => {
			commitStarted.resolve();
			await releaseCommit.promise;
		},
	});
	const plan = directWavPlan();
	const fixture = createFixture(plan);
	const previousOutput = Object.freeze({ url: 'blob:previous', fileName: 'previous.wav' });
	fixture.state.outputUrl = 'blob:previous';
	fixture.state.exportOutput = previousOutput;
	fixture.setPrepared(destination.prepared);
	const service = createEditorExportService(fixture.runtime);
	const saving = service.handleExportAction('export');

	await commitStarted.promise;
	await service.handleExportAction('cancel');
	const snapshotsAfterCancellation = fixture.snapshots();
	releaseCommit.resolve();
	const result = await saving;

	assert.deepEqual(result, {
		url: null,
		fileName: 'direct.wav',
		mimeType: 'audio/wav',
		size: plan.outputFileBytesPerRender,
		method: 'file-system-access',
	});
	assert.equal(destination.commitCalls(), 1);
	assert.equal(destination.abortCalls(), 0);
	assert.equal(fixture.state.exportOutput, null);
	assert.equal(fixture.state.outputUrl, null);
	assert.equal(fixture.statuses.includes('Done'), false);
	assert.equal(fixture.snapshots(), snapshotsAfterCancellation);
});

test('prior output cleanup failure aborts direct staging before commit', async () => {
	const destination = createPreparedStream();
	const fixture = createFixture();
	fixture.state.exportOutput = Object.freeze({ fileName: 'previous.wav' });
	fixture.state.outputCleanup = async () => { throw new Error('prior output cleanup failed'); };
	fixture.setPrepared(destination.prepared);

	assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export'), undefined);
	assert.equal(destination.commitCalls(), 0);
	assert.equal(destination.abortCalls(), 1);
	assert.match((fixture.errors[0] as Error).message, /prior output cleanup failed/iu);
	assert.deepEqual(fixture.state.exportOutput, { fileName: 'previous.wav' });
	assert.equal(fixture.statuses.includes('Done'), false);
});
