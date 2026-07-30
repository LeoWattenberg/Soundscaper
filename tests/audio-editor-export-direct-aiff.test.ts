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
} from './helpers/direct-pcm-export-fixture.ts';

interface AiffPlan extends Record<string, unknown> {
	format: string;
	mimeType: string;
	mode: string;
	outputFileBytesPerRender: number | null;
	outputs: Array<{ fileName: string; trackId: string }>;
	render: { strategy: string };
}

function directAiffPlan(overrides: Partial<AiffPlan> = {}): AiffPlan {
	return {
		format: 'aiff',
		mimeType: 'audio/aiff',
		mode: 'mix',
		outputFileBytesPerRender: 58,
		outputs: [{ fileName: 'mix.aiff', trackId: 'track' }],
		render: { strategy: 'realtime-stream' },
		...overrides,
	};
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
	for (const candidate of [
		directAiffPlan({ format: 'wav' }),
		directAiffPlan({ format: 'bwf' }),
		directAiffPlan({ format: 'bw64' }),
		directAiffPlan({ mimeType: 'audio/x-aiff' }),
		directAiffPlan({ mode: 'stems' }),
		directAiffPlan({ outputs: [
			{ fileName: 'mix.aiff', trackId: 'track' },
			{ fileName: 'other.aiff', trackId: 'other' },
		] }),
		directAiffPlan({ outputs: [{ fileName: 'mix.aif', trackId: 'track' }] }),
		directAiffPlan({ outputFileBytesPerRender: null }),
		directAiffPlan({ outputFileBytesPerRender: 0 }),
		directAiffPlan({ outputFileBytesPerRender: Number.MAX_SAFE_INTEGER + 1 }),
		directAiffPlan({ outputFileBytesPerRender: AIFF_MAXIMUM_FILE_BYTES + 1 }),
		directAiffPlan({ render: { strategy: 'offline' } }),
	]) {
		let prepareCalls = 0;
		const preparation = await prepareDirectAiffDestination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, candidate, {}, new AbortController().signal);
		assert.equal(prepareCalls, 0, `${candidate.format}:${candidate.mimeType}`);
		assert.deepEqual(preparation, { cancelled: null, destination: null });
	}

	const requests: Array<Readonly<Record<string, unknown>>> = [];
	const admissions: Array<readonly [number, 'exact']> = [];
	let abortCalls = 0;
	const signal = new AbortController().signal;
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
	}, directAiffPlan({
		outputs: [{ fileName: 'MIX.AIFF', trackId: 'track' }],
		outputFileBytesPerRender: DIRECT_AIFF_MAXIMUM_FILE_BYTES,
	}), {
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
	assert.deepEqual(admissions, [[DIRECT_AIFF_MAXIMUM_FILE_BYTES, 'exact']]);
	assert.equal(preparation.cancelled, null);
	assert.ok(preparation.destination);
	await preparation.destination.abort();
	assert.equal(abortCalls, 1);
});

test('exact realtime AIFF uses the shared bounded PCM route without Blob fallback', async () => {
	const plan = directPlan({
		format: 'aiff',
		mimeType: 'audio/aiff',
		outputs: [{ fileName: 'mix.aiff', trackId: 'track' }],
	});
	const fixture = createDirectPcmExportFixture(plan, {
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
	assert.deepEqual(destination.admissions, [[4, 'exact']]);
	assert.deepEqual(destination.chunks.map((chunk) => [...chunk]), [[0], [1, 2, 3]]);
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
		size: 4,
		method: 'file-system-access',
	});
	assert.equal(fixture.state.outputUrl, null);
});

test('direct AIFF picker and mid-stream cancellation publish nothing', async () => {
	const plan = directPlan({
		format: 'aiff',
		mimeType: 'audio/aiff',
		outputs: [{ fileName: 'mix.aiff', trackId: 'track' }],
	});
	const pickerCancellation = createDirectPcmExportFixture(plan);
	pickerCancellation.setPrepared(Object.freeze({ mode: 'cancelled', cancelled: true, fileName: 'mix.aiff' }));
	const pickerResult = await createEditorExportService(pickerCancellation.runtime).handleExportAction('export');
	assert.equal(pickerResult.cancelled, true);
	assert.deepEqual(pickerCancellation.encoderKinds, []);
	assert.equal(pickerCancellation.calls.includes('render:chunk:1'), false);

	const writeStarted = deferred();
	const releaseWrite = deferred();
	const plannedBytes = 1 + 2 * DIRECT_PCM_DESTINATION_WRITE_BYTES + 1;
	const cancellationPlan = directPlan({
		...plan,
		outputFileBytesPerRender: plannedBytes,
	});
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
