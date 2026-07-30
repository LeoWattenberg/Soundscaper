/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AIFF_MAXIMUM_FILE_BYTES,
	createAiffStreamEncoder,
	inspectAiffLayout,
} from '../src/common/editor/aiff.js';
import {
	DIRECT_AIFF_MAXIMUM_FILE_BYTES,
	createDirectAiffEncoder,
	prepareDirectAiffDestination,
} from '../src/common/editor/controller/direct-aiff-export.ts';
import { createEditorExportService } from '../src/common/editor/controller/export-service.ts';
import {
	DIRECT_PCM_DESTINATION_WRITE_BYTES,
	DIRECT_PCM_RENDER_CHUNK_FRAMES,
	directPcmMaximumPendingChunks,
} from '../src/common/editor/controller/direct-pcm-export.ts';
import {
	createDirectPcmExportFixture,
	createPreparedStream,
	deferred,
	directPlan,
	type TestPlan,
} from './helpers/direct-pcm-export-fixture.ts';

interface AiffEncoding extends Readonly<Record<string, unknown>> {
	bitDepth: number;
	floatingPoint: boolean;
	sampleFormat: string;
}

interface AiffPlan extends Record<string, unknown> {
	channelCount: number;
	encoding: AiffEncoding;
	format: string;
	metadata: Readonly<Record<string, unknown>>;
	mimeType: string;
	mode: string;
	outputFileBytesPerRender: number;
	outputFrames: number;
	outputs: Array<{ fileName: string; trackId: string }>;
	render: { strategy: string };
	sampleRate: number;
}

type AiffFixturePlan = TestPlan & AiffPlan;

function directAiffPlan(overrides: Readonly<Record<string, unknown>> = {}): AiffPlan {
	const plan = {
		channelCount: 2,
		encoding: Object.freeze({ bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' }),
		format: 'aiff',
		metadata: Object.freeze({}),
		mimeType: 'audio/aiff',
		mode: 'mix',
		outputFileBytesPerRender: 0,
		outputFrames: 2,
		outputs: [{ fileName: 'mix.aiff', trackId: 'track' }],
		render: { strategy: 'realtime-stream' },
		sampleRate: 48_000,
		...overrides,
	} as AiffPlan;
	if (Object.hasOwn(overrides, 'outputFileBytesPerRender')) return plan;
	return { ...plan, outputFileBytesPerRender: aiffLayout(plan).byteLength };
}

function directAiffFixturePlan(overrides: Readonly<Record<string, unknown>> = {}): AiffFixturePlan {
	const plan = {
		...directPlan(),
		format: 'aiff',
		metadata: Object.freeze({}),
		mimeType: 'audio/aiff',
		outputs: [{ fileName: 'mix.aiff', trackId: 'track' }],
		...overrides,
	} as AiffFixturePlan;
	return { ...plan, outputFileBytesPerRender: aiffLayout(plan).byteLength };
}

function aiffLayout(plan: AiffPlan): ReturnType<typeof inspectAiffLayout> {
	return inspectAiffLayout({
		sampleRate: plan.sampleRate,
		channelCount: plan.channelCount,
		totalFrames: plan.outputFrames,
		sampleFormat: plan.encoding.sampleFormat,
		metadata: plan.metadata,
	});
}

test('direct AIFF encoder preserves exact FORM, padding, and metadata geometry', async () => {
	const options = {
		sampleRate: 48_000,
		channelCount: 1,
		totalFrames: 1,
		sampleFormat: 'int24',
		dither: 'none',
		metadata: { title: 'Direct AIFF' },
	} as const;
	const layout = inspectAiffLayout(options);
	const chunks: Uint8Array[] = [];
	let closed = false;
	const encoder = await createDirectAiffEncoder({
		async write(chunk) { chunks.push(chunk.slice()); },
		async close() { closed = true; },
		async abort() {},
		bytesWritten: () => chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
		async commit() { return Object.freeze({ size: layout.byteLength }); },
	}, createAiffStreamEncoder, options);
	await encoder.write([Float32Array.of(0.25)]);
	assert.equal(await encoder.finalize(), layout.byteLength);
	assert.equal(closed, true);
	assert.equal(chunks.reduce((total, chunk) => total + chunk.byteLength, 0), layout.byteLength);
	assert.equal(chunks[0].byteLength, layout.headerByteLength);
	const header = chunks[0];
	assert.equal(String.fromCharCode(...header.subarray(0, 4)), 'FORM');
	assert.equal(String.fromCharCode(...header.subarray(8, 12)), 'AIFF');
	assert.equal(new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(4, false) + 8, layout.byteLength);
	assert.equal(chunks.at(-1)?.byteLength, layout.dataByteLength + layout.dataPadByteLength + layout.trailingByteLength);
});

test('direct AIFF admission is exact and opens the canonical PCM mix target', async () => {
	assert.equal(DIRECT_AIFF_MAXIMUM_FILE_BYTES, AIFF_MAXIMUM_FILE_BYTES);
	const valid = directAiffPlan();
	const incorrectlyAdmitted: string[] = [];
	for (const [label, candidate] of [
		['wrong format', { ...valid, format: 'wav' }],
		['BWF format', { ...valid, format: 'bwf' }],
		['BW64 format', { ...valid, format: 'bw64' }],
		['wrong MIME type', { ...valid, mimeType: 'audio/x-aiff' }],
		['stems', { ...valid, mode: 'stems' }],
		['multiple outputs', { ...valid, outputs: [
			{ fileName: 'mix.aiff', trackId: 'track' },
			{ fileName: 'other.aiff', trackId: 'other' },
		] }],
		['wrong extension', { ...valid, outputs: [{ fileName: 'mix.aif', trackId: 'track' }] }],
		['missing byte count', { ...valid, outputFileBytesPerRender: undefined }],
		['zero byte count', { ...valid, outputFileBytesPerRender: 0 }],
		['fractional byte count', { ...valid, outputFileBytesPerRender: 1.5 }],
		['unsafe byte count', { ...valid, outputFileBytesPerRender: Number.MAX_SAFE_INTEGER + 1 }],
		['over-limit byte count', { ...valid, outputFileBytesPerRender: AIFF_MAXIMUM_FILE_BYTES + 1 }],
		['layout byte-count mismatch', { ...valid, outputFileBytesPerRender: valid.outputFileBytesPerRender + 2 }],
		['stale channel geometry', { ...valid, channelCount: 1 }],
		['stale frame geometry', { ...valid, outputFrames: valid.outputFrames + 1 }],
		['stale sample format', { ...valid, encoding: {
			bitDepth: 16, floatingPoint: false, sampleFormat: 'int16',
		} }],
		['stale metadata geometry', { ...valid, metadata: { title: 'Changed' } }],
		['offline render', { ...valid, render: { strategy: 'offline' } }],
		['missing sample rate', { ...valid, sampleRate: undefined }],
		['zero sample rate', { ...valid, sampleRate: 0 }],
		['string sample rate', { ...valid, sampleRate: '48000' }],
		['fractional sample rate', { ...valid, sampleRate: 48_000.5 }],
		['missing channel count', { ...valid, channelCount: undefined }],
		['zero channel count', { ...valid, channelCount: 0 }],
		['string channel count', { ...valid, channelCount: '2' }],
		['fractional channel count', { ...valid, channelCount: 1.5 }],
		['over-limit channel count', { ...valid, channelCount: 33 }],
		['missing output frames', { ...valid, outputFrames: undefined }],
		['string output frames', { ...valid, outputFrames: '2' }],
		['fractional output frames', { ...valid, outputFrames: 1.5 }],
		['negative output frames', { ...valid, outputFrames: -1 }],
		['over-limit output frames', { ...valid, outputFrames: 0x1_0000_0000 }],
		['missing encoding', { ...valid, encoding: undefined }],
		['null encoding', { ...valid, encoding: null }],
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
		['bit-depth mismatch', { ...valid, encoding: {
			bitDepth: 16, floatingPoint: false, sampleFormat: 'int24',
		} }],
		['unsupported sample format', { ...valid, encoding: {
			bitDepth: 20, floatingPoint: false, sampleFormat: 'int20',
		} }],
		['floating-point mismatch', { ...valid, encoding: {
			bitDepth: 24, floatingPoint: true, sampleFormat: 'int24',
		} }],
		['integer-32 floating-point mismatch', { ...valid, encoding: {
			bitDepth: 32, floatingPoint: true, sampleFormat: 'int32',
		} }],
		['float-32 integer mismatch', { ...valid, encoding: {
			bitDepth: 32, floatingPoint: false, sampleFormat: 'float32',
		} }],
		['missing metadata', { ...valid, metadata: undefined }],
		['null metadata', { ...valid, metadata: null }],
		['array metadata', { ...valid, metadata: [] }],
		['malformed metadata', { ...valid, metadata: { title: '\u0001' } }],
	] satisfies Array<readonly [string, Readonly<Record<string, unknown>>]>) {
		let prepareCalls = 0;
		const preparation = await prepareDirectAiffDestination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, candidate as Parameters<typeof prepareDirectAiffDestination>[1], {}, new AbortController().signal);
		if (prepareCalls !== 0) incorrectlyAdmitted.push(label);
		assert.deepEqual(preparation, { cancelled: null, destination: null });
	}
	assert.deepEqual(incorrectlyAdmitted, []);

	for (const encoding of [
		Object.freeze({ bitDepth: 16, floatingPoint: false, sampleFormat: 'int16' }),
		Object.freeze({ bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' }),
		Object.freeze({ bitDepth: 32, floatingPoint: false, sampleFormat: 'int32' }),
		Object.freeze({ bitDepth: 32, floatingPoint: true, sampleFormat: 'float32' }),
	]) {
		const plan = directAiffPlan({ encoding });
		let prepareCalls = 0;
		await prepareDirectAiffDestination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, plan, {}, new AbortController().signal);
		assert.equal(prepareCalls, 1, encoding.sampleFormat);
		assert.equal(aiffLayout(plan).container, encoding.floatingPoint ? 'aifc' : 'aiff');
	}
	const richPlan = directAiffPlan({
		channelCount: 1,
		encoding: Object.freeze({ bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' }),
		metadata: Object.freeze({ title: 'Exact direct AIFF' }),
		outputFrames: 1,
	});
	const richLayout = aiffLayout(richPlan);
	assert.equal(richLayout.dataByteLength, 3);
	assert.equal(richLayout.dataPadByteLength, 1);
	assert.ok(richLayout.trailingByteLength > 0);
	let richPrepareCalls = 0;
	await prepareDirectAiffDestination({
		prepareSave() {
			richPrepareCalls += 1;
			return Object.freeze({ mode: 'blob' });
		},
	}, richPlan, {}, new AbortController().signal);
	assert.equal(richPrepareCalls, 1);

	const requests: Array<Readonly<Record<string, unknown>>> = [];
	const admissions: Array<readonly [number, 'exact']> = [];
	let abortCalls = 0;
	const signal = new AbortController().signal;
	const maximumPlan = directAiffPlan({
		channelCount: 1,
		encoding: Object.freeze({ bitDepth: 16, floatingPoint: false, sampleFormat: 'int16' }),
		outputFrames: 2_147_483_624,
		outputs: [{ fileName: 'MIX.AIFF', trackId: 'track' }],
	});
	const maximumLayout = aiffLayout(maximumPlan);
	assert.equal(maximumLayout.byteLength, 4_294_967_302);
	assert.equal(maximumLayout.byteLength, DIRECT_AIFF_MAXIMUM_FILE_BYTES - 1);
	assert.throws(
		() => aiffLayout({ ...maximumPlan, outputFrames: maximumPlan.outputFrames + 1 }),
		/32-bit FORM size/iu,
	);
	let overflowPrepareCalls = 0;
	const overflowPreparation = await prepareDirectAiffDestination({
		prepareSave() {
			overflowPrepareCalls += 1;
			return Object.freeze({ mode: 'blob' });
		},
	}, {
		...maximumPlan,
		outputFrames: maximumPlan.outputFrames + 1,
	}, {}, signal);
	assert.equal(overflowPrepareCalls, 0);
	assert.deepEqual(overflowPreparation, { cancelled: null, destination: null });
	const preparation = await prepareDirectAiffDestination({
		prepareSave(request) {
			requests.push(request);
			return Object.freeze({
				mode: 'stream' as const,
				async createWritable(byteLength: number, sizeMode: 'exact') {
					admissions.push([byteLength, sizeMode]);
					return new WritableStream<Uint8Array>();
				},
				bytesWritten: () => 0,
				async commit() { return Object.freeze({ size: 0 }); },
				async abort() { abortCalls += 1; },
			});
		},
	}, maximumPlan, {
		saveTarget: { id: 'native-target' },
		useFileSystemAccess: true,
	}, signal);

	assert.deepEqual(requests, [{
		purpose: 'audio-pcm-mix',
		suggestedName: 'MIX.AIFF',
		mimeType: 'audio/aiff',
		target: { id: 'native-target' },
		types: [{ description: 'AIFF audio', accept: { 'audio/aiff': ['.aiff'] } }],
		useFileSystemAccess: true,
		signal,
	}]);
	assert.deepEqual(admissions, [[maximumLayout.byteLength, 'exact']]);
	assert.equal(preparation.cancelled, null);
	assert.ok(preparation.destination);
	await preparation.destination.abort();
	assert.equal(abortCalls, 1);
});

test('exact realtime AIFF uses the shared bounded PCM route without Blob fallback', async () => {
	const plan = directAiffFixturePlan();
	const fixture = createDirectPcmExportFixture(plan, {
		encoderFinalByteLength: plan.outputFileBytesPerRender,
		encoderInitialChunks: [new Uint8Array(plan.outputFileBytesPerRender - 3)],
		publishedFileName: 'direct.aiff',
		publishedMimeType: 'audio/aiff',
	});
	const destination = createPreparedStream({
		publishedFileName: 'direct.aiff',
		publishedMimeType: 'audio/aiff',
	});
	fixture.setPrepared(destination.prepared);
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export', {
		saveTarget: { id: 'target' },
		useFileSystemAccess: true,
	});

	assert.deepEqual(fixture.encoderKinds, ['aiff']);
	assert.deepEqual(destination.admissions, [[plan.outputFileBytesPerRender, 'exact']]);
	assert.deepEqual(destination.chunks.map((chunk) => chunk.byteLength), [plan.outputFileBytesPerRender - 3, 3]);
	assert.equal(destination.closeCalls(), 1);
	assert.equal(destination.commitCalls(), 1);
	assert.equal(destination.abortCalls(), 0);
	assert.deepEqual(fixture.preflights, []);
	assert.equal(fixture.calls.includes('temporary:create'), false);
	assert.deepEqual(fixture.downloads, []);
	assert.equal(fixture.renderRequests[0].chunkFrames, DIRECT_PCM_RENDER_CHUNK_FRAMES);
	assert.equal(fixture.renderRequests[0].maximumPendingChunks, directPcmMaximumPendingChunks(2));
	assert.deepEqual(fixture.prepareRequests.map(({ signal: _signal, ...request }) => request), [{
		purpose: 'audio-pcm-mix',
		suggestedName: 'mix.aiff',
		mimeType: 'audio/aiff',
		target: { id: 'target' },
		types: [{ description: 'AIFF audio', accept: { 'audio/aiff': ['.aiff'] } }],
		useFileSystemAccess: true,
	}]);
	assert.ok(fixture.prepareRequests[0].signal instanceof AbortSignal);
	assert.deepEqual(result, {
		url: null,
		fileName: 'direct.aiff',
		mimeType: 'audio/aiff',
		size: plan.outputFileBytesPerRender,
		method: 'file-system-access',
	});
	assert.equal(fixture.state.outputUrl, null);
});

test('direct AIFF picker and mid-stream cancellation publish nothing', async () => {
	const plan = directAiffFixturePlan();
	const pickerCancellation = createDirectPcmExportFixture(plan);
	pickerCancellation.setPrepared(Object.freeze({ mode: 'cancelled', cancelled: true, fileName: 'mix.aiff' }));
	const pickerResult = await createEditorExportService(pickerCancellation.runtime).handleExportAction('export');
	assert.equal(pickerResult.cancelled, true);
	assert.deepEqual(pickerCancellation.encoderKinds, []);
	assert.equal(pickerCancellation.calls.includes('render:chunk:1'), false);

	const writeStarted = deferred();
	const releaseWrite = deferred();
	const cancellationPlan = directAiffFixturePlan({
		encoding: Object.freeze({ bitDepth: 16, floatingPoint: false, sampleFormat: 'int16' }),
		outputFrames: Math.ceil((2 * DIRECT_PCM_DESTINATION_WRITE_BYTES) / 4) + 1,
	});
	const plannedBytes = cancellationPlan.outputFileBytesPerRender;
	const cancelled = createDirectPcmExportFixture(cancellationPlan, {
		encoderFinalByteLength: plannedBytes,
		encoderWriteChunks: (block) => [new Uint8Array(DIRECT_PCM_DESTINATION_WRITE_BYTES).fill(block)],
	});
	const destination = createPreparedStream({
		onWrite: async (chunk) => {
			if (chunk.byteLength !== DIRECT_PCM_DESTINATION_WRITE_BYTES) return;
			writeStarted.resolve();
			await releaseWrite.promise;
		},
	});
	cancelled.setPrepared(destination.prepared);
	const service = createEditorExportService(cancelled.runtime);
	const saving = service.handleExportAction('export');
	await writeStarted.promise;
	await service.handleExportAction('cancel');
	releaseWrite.resolve();
	assert.equal(await saving, undefined);
	assert.deepEqual(cancelled.encoderKinds, ['aiff']);
	assert.equal(destination.chunks.reduce((total, chunk) => total + chunk.byteLength, 0), 1 + DIRECT_PCM_DESTINATION_WRITE_BYTES);
	assert.equal(destination.closeCalls(), 0);
	assert.equal(destination.commitCalls(), 0);
	assert.equal(destination.abortCalls(), 1);
	assert.deepEqual(cancelled.downloads, []);
	assert.equal(cancelled.state.exportOutput, null);
});
