/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_DESKTOP_SAVE_BYTES } from '../desktop/constants.js';
import { createEditorExportService } from '../src/common/editor/controller/export-service.ts';
import {
	DIRECT_PCM_DESTINATION_WRITE_BYTES, DIRECT_PCM_MAXIMUM_PENDING_BYTES, DIRECT_PCM_RENDER_CHUNK_FRAMES,
	createDirectPcmEncoder, directPcmMaximumPendingChunks,
} from '../src/common/editor/controller/direct-pcm-export.ts';
import { DIRECT_WAV_MAXIMUM_FILE_BYTES, prepareDirectWavDestination } from '../src/common/editor/controller/direct-wav-export.ts';
import {
	createDirectPcmExportFixture as createFixture, createPreparedStream, deferred, directPlan,
	type TestPlan,
} from './helpers/direct-pcm-export-fixture.ts';

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

test('exact realtime WAV mixes await coalesced destination writes and publish no Blob', async () => {
	const fixture = createFixture();
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

	assert.deepEqual(destination.admissions, [[4, 'exact']]);
	assert.deepEqual(destination.chunks.map((chunk) => [...chunk]), [[0], [1, 2, 3]]);
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
		size: 4,
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
	const fixture = createFixture({ ...directPlan(), channelCount: 16, channelMapping: mapping });
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

test('direct WAV admission is exact and keeps other PCM plans on their existing path', async () => {
	assert.equal(DIRECT_WAV_MAXIMUM_FILE_BYTES, MAX_DESKTOP_SAVE_BYTES);
	for (const candidate of [
		{ ...directPlan(), format: 'bwf' },
		{ ...directPlan(), format: 'bw64' },
		{ ...directPlan(), format: 'aiff' },
		{ ...directPlan(), mimeType: 'audio/x-wav' },
		{ ...directPlan(), mode: 'stems' },
		{ ...directPlan(), outputs: [...directPlan().outputs, { fileName: 'other.wav', trackId: 'other' }] },
		{ ...directPlan(), outputs: [{ fileName: 'mix.wave', trackId: 'track' }] },
		{ ...directPlan(), outputFileBytesPerRender: null },
		{ ...directPlan(), outputFileBytesPerRender: 0 },
		{ ...directPlan(), outputFileBytesPerRender: DIRECT_WAV_MAXIMUM_FILE_BYTES + 1 },
		{ ...directPlan(), render: { strategy: 'offline' } },
	] satisfies TestPlan[]) {
		let prepareCalls = 0;
		const preparation = await prepareDirectWavDestination({
			prepareSave() { prepareCalls += 1; return Object.freeze({ mode: 'blob' }); },
		}, candidate, {}, new AbortController().signal);
		assert.equal(prepareCalls, 0, `${candidate.format}:${candidate.mode}`);
		assert.equal(preparation.cancelled, null);
		assert.equal(preparation.destination, null);
	}
	let boundaryCalls = 0;
	await prepareDirectWavDestination({
		prepareSave() { boundaryCalls += 1; return Object.freeze({ mode: 'blob' }); },
	}, {
		...directPlan(),
		outputs: [{ fileName: 'MIX.WAV', trackId: 'track' }],
		outputFileBytesPerRender: DIRECT_WAV_MAXIMUM_FILE_BYTES,
	}, {}, new AbortController().signal);
	assert.equal(boundaryCalls, 1);

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
			'encoder', createFixture(directPlan(), { encoderFinalByteLength: 3 }),
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
	const fixture = createFixture();
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
		size: 4,
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
