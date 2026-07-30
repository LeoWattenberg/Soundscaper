/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBextMetadata, type BextMetadata } from '../src/common/editor/broadcast-wave.ts';
import {
	DIRECT_BWF_MAXIMUM_FILE_BYTES,
	prepareDirectBwfDestination,
} from '../src/common/editor/controller/direct-bwf-export.ts';
import { createEditorExportService, type ExportServiceRuntime } from '../src/common/editor/controller/export-service.ts';
import {
	DIRECT_PCM_DESTINATION_WRITE_BYTES,
	DIRECT_PCM_RENDER_CHUNK_FRAMES,
	directPcmMaximumPendingChunks,
} from '../src/common/editor/controller/direct-pcm-export.ts';
import { createWavStreamEncoder, inspectWavLayout } from '../src/common/editor/wav.js';
import {
	createDirectPcmExportFixture,
	createPreparedStream,
	deferred,
	directPlan,
	type TestPlan,
} from './helpers/direct-pcm-export-fixture.ts';

interface BwfPlan extends TestPlan {
	bext: BextMetadata;
}

const BEXT = normalizeBextMetadata({
	description: 'Direct broadcast master',
	originator: 'Soundscaper',
	timeReference: '48000',
	codingHistory: 'A=PCM,F=48000,W=24,M=stereo,T=Soundscaper\n',
}, { version: 2 });

function directBwfPlan(overrides: Readonly<Record<string, unknown>> = {}): BwfPlan {
	return {
		...directPlan(),
		format: 'bwf',
		bext: BEXT,
		encoding: Object.freeze({
			bitDepth: 24,
			floatingPoint: false,
			sampleFormat: 'int24',
			bext: BEXT,
		}),
		...overrides,
	} as BwfPlan;
}

function directBwfPlanForDepth(bitDepth: 16 | 20 | 24): BwfPlan {
	return directBwfPlan({
		encoding: Object.freeze({
			bitDepth,
			floatingPoint: false,
			sampleFormat: `int${String(bitDepth)}`,
			bext: BEXT,
		}),
	});
}

test('direct BWF admission is closed over canonical integer Broadcast WAV plans', async () => {
	const forgedWav = directPlan();
	for (const [candidate, settings] of [
		[{ ...forgedWav, format: 'bwf' }, {}],
		[directBwfPlan({ format: 'wav' }), {}],
		[directBwfPlan({ format: 'bw64' }), {}],
		[directBwfPlan({ mimeType: 'audio/x-wav' }), {}],
		[directBwfPlan({ mode: 'stems' }), {}],
		[directBwfPlan({ outputs: [
			{ fileName: 'mix.wav', trackId: 'track' },
			{ fileName: 'other.wav', trackId: 'other' },
		] }), {}],
		[directBwfPlan({ outputs: [{ fileName: 'mix.bwf', trackId: 'track' }] }), {}],
		[directBwfPlan({ outputFileBytesPerRender: null }), {}],
		[directBwfPlan({ outputFileBytesPerRender: 0 }), {}],
		[directBwfPlan({ outputFileBytesPerRender: 1.5 }), {}],
		[directBwfPlan({ outputFileBytesPerRender: Number.MAX_SAFE_INTEGER + 1 }), {}],
		[directBwfPlan({ outputFileBytesPerRender: DIRECT_BWF_MAXIMUM_FILE_BYTES + 1 }), {}],
		[directBwfPlan({ render: { strategy: 'offline' } }), {}],
		[directBwfPlan({ container: 'bw64' }), {}],
		[directBwfPlan({ adm: { mode: 'authored' } }), {}],
		[directBwfPlan({ preDataChunks: new Uint8Array([1]) }), {}],
		[directBwfPlan({ trailingChunks: new Uint8Array([2]) }), {}],
		[directBwfPlan({ bext: { description: BEXT.description } }), {}],
		[directBwfPlan({ bext: { ...BEXT, unexpected: true } }), {}],
		[directBwfPlan({ encoding: {
			bitDepth: 24, floatingPoint: false, sampleFormat: 'int24',
		} }), {}],
		[directBwfPlan({ encoding: {
			bitDepth: 24, floatingPoint: false, sampleFormat: 'int24', bext: { description: BEXT.description },
		} }), {}],
		[directBwfPlan({ encoding: {
			bitDepth: 32, floatingPoint: false, sampleFormat: 'int32', bext: BEXT,
		} }), {}],
		[directBwfPlan({ encoding: {
			bitDepth: 24, floatingPoint: true, sampleFormat: 'float32', bext: BEXT,
		} }), {}],
		[directBwfPlan({ encoding: {
			bitDepth: 24, floatingPoint: false, sampleFormat: 'int20', bext: BEXT,
		} }), {}],
	] satisfies Array<readonly [Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>]>) {
		let prepareCalls = 0;
		const preparation = await prepareDirectBwfDestination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, candidate, settings, new AbortController().signal);
		assert.equal(prepareCalls, 0, `${String(candidate.format)}:${String(candidate.mimeType)}`);
		assert.deepEqual(preparation, { cancelled: null, destination: null });
	}

	for (const bitDepth of [16, 20, 24] as const) {
		let prepareCalls = 0;
		await prepareDirectBwfDestination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, directBwfPlanForDepth(bitDepth), {}, new AbortController().signal);
		assert.equal(prepareCalls, 1, `int${String(bitDepth)}`);
	}

	const requests: Array<Readonly<Record<string, unknown>>> = [];
	const destination = createPreparedStream();
	const signal = new AbortController().signal;
	const preparation = await prepareDirectBwfDestination({
		prepareSave(request) {
			requests.push(request);
			return destination.prepared;
		},
	}, directBwfPlan({
		outputs: [{ fileName: 'MASTER.WAV', trackId: 'track' }],
		outputFileBytesPerRender: DIRECT_BWF_MAXIMUM_FILE_BYTES,
	}), {
		saveTarget: { id: 'native-target' },
		useFileSystemAccess: true,
	}, signal);

	assert.deepEqual(requests, [{
		purpose: 'audio-pcm-mix',
		suggestedName: 'MASTER.WAV',
		mimeType: 'audio/wav',
		target: { id: 'native-target' },
		types: [{ description: 'Broadcast WAV (BWF) audio', accept: { 'audio/wav': ['.wav'] } }],
		useFileSystemAccess: true,
		signal,
	}]);
	assert.deepEqual(destination.admissions, [[DIRECT_BWF_MAXIMUM_FILE_BYTES, 'exact']]);
	assert.ok(preparation.destination);
	await preparation.destination.abort();
	assert.equal(destination.abortCalls(), 1);
});

test('exact realtime BWF forwards BEXT through the WAV encoder and publishes its exact layout', async () => {
	const layout = inspectWavLayout({
		sampleRate: 48_000,
		channelCount: 2,
		totalFrames: 2,
		bitDepth: 24,
		float: false,
		bext: BEXT,
	});
	const plan = directBwfPlan({ outputFileBytesPerRender: layout.byteLength });
	const fixture = createDirectPcmExportFixture(plan);
	const destination = createPreparedStream({ publishedSize: layout.byteLength });
	fixture.setPrepared(destination.prepared);
	const encoderOptions: Array<Readonly<Record<string, unknown>>> = [];
	let wavEncoderCalls = 0;
	const runtime: ExportServiceRuntime = {
		...fixture.runtime,
		createWavStreamEncoder(options: Parameters<typeof createWavStreamEncoder>[0]) {
			wavEncoderCalls += 1;
			encoderOptions.push(options);
			return createWavStreamEncoder(options);
		},
	};
	const result = await createEditorExportService(runtime).handleExportAction('export', {
		saveTarget: { id: 'target' },
		useFileSystemAccess: true,
	});
	const bytes = joinBytes(destination.chunks);

	assert.equal(wavEncoderCalls, 1);
	assert.deepEqual(encoderOptions[0]?.bext, BEXT);
	assert.equal(encoderOptions[0]?.float, false);
	assert.equal(encoderOptions[0]?.sampleFormat, 'int24');
	assert.deepEqual(destination.admissions, [[layout.byteLength, 'exact']]);
	assert.equal(bytes.byteLength, layout.byteLength);
	assert.equal(textAt(bytes, 0), 'RIFF');
	assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8, bytes.byteLength);
	assert.equal(textAt(bytes, 8), 'WAVE');
	assert.equal(textAt(bytes, 12), 'bext');
	const bextPayloadBytes = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16, true);
	const formatOffset = 20 + bextPayloadBytes + (bextPayloadBytes & 1);
	assert.equal(textAt(bytes, formatOffset), 'fmt ');
	assert.equal(textAt(bytes, formatOffset + 24), 'data');
	assert.equal(destination.prepared.bytesWritten(), layout.byteLength);
	assert.equal(destination.closeCalls(), 1);
	assert.equal(destination.commitCalls(), 1);
	assert.equal(destination.abortCalls(), 0);
	assert.deepEqual(fixture.preflights, []);
	assert.equal(fixture.calls.includes('temporary:create'), false);
	assert.deepEqual(fixture.downloads, []);
	assert.equal(fixture.renderRequests[0].chunkFrames, DIRECT_PCM_RENDER_CHUNK_FRAMES);
	assert.equal(fixture.renderRequests[0].maximumPendingChunks, directPcmMaximumPendingChunks(2, 'BWF'));
	assert.deepEqual(fixture.prepareRequests.map(({ signal: _signal, ...request }) => request), [{
		purpose: 'audio-pcm-mix',
		suggestedName: 'mix.wav',
		mimeType: 'audio/wav',
		target: { id: 'target' },
		types: [{ description: 'Broadcast WAV (BWF) audio', accept: { 'audio/wav': ['.wav'] } }],
		useFileSystemAccess: true,
	}]);
	assert.deepEqual(result, {
		url: null,
		fileName: 'direct.wav',
		mimeType: 'audio/wav',
		size: layout.byteLength,
		method: 'file-system-access',
	});
});

test('realtime BWF loudness measurement fails closed before target or render work', async () => {
	const plan = directBwfPlan();
	const fixture = createDirectPcmExportFixture(plan);
	const destination = createPreparedStream();
	fixture.setPrepared(destination.prepared);
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export', {
		measureLoudness: true,
	});

	assert.equal(result, undefined);
	assert.match((fixture.errors[0] as Error).message, /realtime Broadcast WAV loudness measurement.*not supported/iu);
	assert.equal(destination.admissions.length, 0);
	assert.equal(destination.commitCalls(), 0);
	assert.deepEqual(fixture.prepareRequests, []);
	assert.deepEqual(fixture.preflights, []);
	assert.equal(fixture.calls.includes('temporary:create'), false);
	assert.deepEqual(fixture.downloads, []);
});

test('direct BWF four-way size diagnostics identify the Broadcast WAV container', async () => {
	for (const [label, fixture, destination, expectedCommitCalls, expectedAbortCalls] of [
		[
			'encoder', createDirectPcmExportFixture(directBwfPlan(), { encoderFinalByteLength: 3 }),
			createPreparedStream(), 0, 1,
		],
		[
			'destination', createDirectPcmExportFixture(directBwfPlan()),
			createPreparedStream({ reportedByteLength: 3 }), 0, 1,
		],
		[
			'committed', createDirectPcmExportFixture(directBwfPlan()),
			createPreparedStream({ publishedSize: 3 }), 1, 0,
		],
	] as const) {
		fixture.setPrepared(destination.prepared);
		assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export'), undefined);
		assert.equal(destination.commitCalls(), expectedCommitCalls, `${label} commit count`);
		assert.equal(destination.abortCalls(), expectedAbortCalls, `${label} abort count`);
		assert.match((fixture.errors[0] as Error).message, new RegExp(`${label}.*BWF|BWF.*${label}`, 'iu'));
		assert.equal(fixture.state.exportOutput, null);
	}
});

test('mid-stream direct BWF cancellation aborts without close, commit, or publication', async () => {
	const writeStarted = deferred();
	const releaseWrite = deferred();
	const plannedBytes = 1 + 2 * DIRECT_PCM_DESTINATION_WRITE_BYTES + 1;
	const plan = directBwfPlan({ outputFileBytesPerRender: plannedBytes });
	const fixture = createDirectPcmExportFixture(plan, {
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
	fixture.setPrepared(destination.prepared);
	const service = createEditorExportService(fixture.runtime);
	const saving = service.handleExportAction('export');
	await writeStarted.promise;
	await service.handleExportAction('cancel');
	releaseWrite.resolve();

	assert.equal(await saving, undefined);
	assert.deepEqual(fixture.encoderKinds, ['wav']);
	assert.equal(destination.chunks.reduce((total, chunk) => total + chunk.byteLength, 0), 1 + DIRECT_PCM_DESTINATION_WRITE_BYTES);
	assert.equal(destination.closeCalls(), 0);
	assert.equal(destination.commitCalls(), 0);
	assert.equal(destination.abortCalls(), 1);
	assert.deepEqual(fixture.downloads, []);
	assert.equal(fixture.state.exportOutput, null);
});

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function textAt(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}
