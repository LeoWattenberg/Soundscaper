/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBextMetadata, type BextMetadata } from '../src/common/editor/broadcast-wave.ts';
import type { CartMetadataInput } from '../src/common/editor/cart-metadata.ts';
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
import type { IxmlMetadataInput } from '../src/common/editor/ixml.ts';
import type { RiffMarkerInput } from '../src/common/editor/riff-markers.ts';
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
	cart: CartMetadataInput | null;
	ixml: IxmlMetadataInput | null;
	markers: readonly RiffMarkerInput[];
	metadata: Readonly<Record<string, unknown>>;
	outputFileBytesPerRender: number;
}

const BEXT = normalizeBextMetadata({
	description: 'Direct broadcast master',
	originator: 'Soundscaper',
	timeReference: '48000',
	codingHistory: 'A=PCM,F=48000,W=24,M=stereo,T=Soundscaper\n',
}, { version: 2 });

function directBwfPlan(overrides: Readonly<Record<string, unknown>> = {}): BwfPlan {
	const plan = {
		...directPlan(),
		format: 'bwf',
		bext: BEXT,
		cart: null,
		encoding: Object.freeze({
			bitDepth: 24,
			floatingPoint: false,
			sampleFormat: 'int24',
			bext: BEXT,
		}),
		ixml: null,
		markers: Object.freeze([]),
		metadata: Object.freeze({}),
	} as BwfPlan;
	return {
		...plan,
		outputFileBytesPerRender: wavLayout(plan).byteLength,
		...overrides,
	} as BwfPlan;
}

function exactDirectBwfPlan(overrides: Readonly<Record<string, unknown>> = {}): BwfPlan {
	const plan = directBwfPlan(overrides);
	return { ...plan, outputFileBytesPerRender: wavLayout(plan).byteLength };
}

function directBwfPlanForDepth(bitDepth: 16 | 20 | 24): BwfPlan {
	return exactDirectBwfPlan({
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
	const valid = directBwfPlan();
	const incorrectlyAdmitted: string[] = [];
	for (const [label, candidate] of [
		['forged WAV plan', { ...forgedWav, format: 'bwf' }],
		['wrong format', directBwfPlan({ format: 'wav' })],
		['BW64 format', directBwfPlan({ format: 'bw64' })],
		['wrong MIME type', directBwfPlan({ mimeType: 'audio/x-wav' })],
		['stems', directBwfPlan({ mode: 'stems' })],
		['multiple outputs', directBwfPlan({ outputs: [
			{ fileName: 'mix.wav', trackId: 'track' },
			{ fileName: 'other.wav', trackId: 'other' },
		] })],
		['wrong extension', directBwfPlan({ outputs: [{ fileName: 'mix.bwf', trackId: 'track' }] })],
		['missing byte count', directBwfPlan({ outputFileBytesPerRender: null })],
		['zero byte count', directBwfPlan({ outputFileBytesPerRender: 0 })],
		['fractional byte count', directBwfPlan({ outputFileBytesPerRender: 1.5 })],
		['unsafe byte count', directBwfPlan({ outputFileBytesPerRender: Number.MAX_SAFE_INTEGER + 1 })],
		['over-limit byte count', directBwfPlan({ outputFileBytesPerRender: DIRECT_BWF_MAXIMUM_FILE_BYTES + 1 })],
		['layout byte-count mismatch', directBwfPlan({
			outputFileBytesPerRender: valid.outputFileBytesPerRender + 2,
		})],
		['offline render', directBwfPlan({ render: { strategy: 'offline' } })],
		['explicit container', directBwfPlan({ container: 'bw64' })],
		['ADM', directBwfPlan({ adm: { mode: 'authored' } })],
		['pre-data chunks', directBwfPlan({ preDataChunks: new Uint8Array([1]) })],
		['trailing chunks', directBwfPlan({ trailingChunks: new Uint8Array([2]) })],
		['missing sample rate', directBwfPlan({ sampleRate: undefined })],
		['fractional sample rate', directBwfPlan({ sampleRate: 48_000.5 })],
		['missing channel count', directBwfPlan({ channelCount: undefined })],
		['over-limit channel count', directBwfPlan({ channelCount: 33 })],
		['missing output frames', directBwfPlan({ outputFrames: undefined })],
		['negative output frames', directBwfPlan({ outputFrames: -1 })],
		['missing metadata', directBwfPlan({ metadata: undefined })],
		['array metadata', directBwfPlan({ metadata: [] })],
		['missing markers', directBwfPlan({ markers: undefined })],
		['object markers', directBwfPlan({ markers: {} })],
		['invalid marker geometry', directBwfPlan({ markers: [{ sampleOffset: -1 }] })],
		['missing iXML', directBwfPlan({ ixml: undefined })],
		['string iXML', directBwfPlan({ ixml: 'forged' })],
		['invalid iXML geometry', directBwfPlan({ ixml: { tracks: [{ channelIndex: 0 }] } })],
		['missing CART', directBwfPlan({ cart: undefined })],
		['string CART', directBwfPlan({ cart: 'forged' })],
		['invalid CART text', directBwfPlan({ cart: { title: '\n' } })],
		['partial BEXT', directBwfPlan({ bext: { description: BEXT.description } })],
		['extended BEXT', directBwfPlan({ bext: { ...BEXT, unexpected: true } })],
		['missing encoding BEXT', directBwfPlan({ encoding: {
			bitDepth: 24, floatingPoint: false, sampleFormat: 'int24',
		} })],
		['partial encoding BEXT', directBwfPlan({ encoding: {
			bitDepth: 24, floatingPoint: false, sampleFormat: 'int24', bext: { description: BEXT.description },
		} })],
		['unsupported depth', directBwfPlan({ encoding: {
			bitDepth: 32, floatingPoint: false, sampleFormat: 'int32', bext: BEXT,
		} })],
		['floating point', directBwfPlan({ encoding: {
			bitDepth: 24, floatingPoint: true, sampleFormat: 'float32', bext: BEXT,
		} })],
		['sample-format mismatch', directBwfPlan({ encoding: {
			bitDepth: 24, floatingPoint: false, sampleFormat: 'int20', bext: BEXT,
		} })],
	] satisfies Array<readonly [string, Readonly<Record<string, unknown>>]>) {
		let prepareCalls = 0;
		const preparation = await prepareDirectBwfDestination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, candidate, {}, new AbortController().signal);
		if (prepareCalls !== 0) incorrectlyAdmitted.push(label);
		assert.deepEqual(preparation, { cancelled: null, destination: null });
	}
	assert.deepEqual(incorrectlyAdmitted, []);

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
	const richPlan = exactDirectBwfPlan({
		metadata: Object.freeze({ artist: 'Soundscaper' }),
		markers: Object.freeze([{ id: 1, sampleOffset: 0, label: 'Start' }]),
		ixml: Object.freeze({ project: 'Broadcast master' }),
		cart: Object.freeze({ title: 'Broadcast master' }),
	});
	let richPrepareCalls = 0;
	await prepareDirectBwfDestination({
		prepareSave() {
			richPrepareCalls += 1;
			return Object.freeze({ mode: 'blob' });
		},
	}, richPlan, {}, new AbortController().signal);
	assert.equal(richPrepareCalls, 1, 'standard BWF metadata contributes to exact admitted geometry');

	const requests: Array<Readonly<Record<string, unknown>>> = [];
	const destination = createPreparedStream();
	const signal = new AbortController().signal;
	const boundaryPlan = largestExactBwfPlan();
	const boundaryLayout = wavLayout(boundaryPlan);
	const nextLayout = wavLayout({ ...boundaryPlan, outputFrames: boundaryPlan.outputFrames + 1 });
	assert.equal(boundaryLayout.container, 'rf64');
	assert.equal(boundaryLayout.byteLength, DIRECT_BWF_MAXIMUM_FILE_BYTES);
	assert.ok(nextLayout.byteLength > DIRECT_BWF_MAXIMUM_FILE_BYTES);
	const preparation = await prepareDirectBwfDestination({
		prepareSave(request) {
			requests.push(request);
			return destination.prepared;
		},
	}, {
		...boundaryPlan,
		outputs: [{ fileName: 'MASTER.WAV', trackId: 'track' }],
	}, {
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
	assert.deepEqual(destination.admissions, [[boundaryLayout.byteLength, 'exact']]);
	assert.ok(preparation.destination);
	await preparation.destination.abort();
	assert.equal(destination.abortCalls(), 1);
});

test('exact realtime BWF forwards BEXT through the WAV encoder and publishes its exact layout', async () => {
	const plan = directBwfPlan();
	const layout = wavLayout(plan);
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
	const plan = directBwfPlan();
	for (const [label, fixture, destination, expectedCommitCalls, expectedAbortCalls] of [
		[
			'encoder', createDirectPcmExportFixture(plan, { encoderFinalByteLength: 3 }),
			createPreparedStream(), 0, 1,
		],
		[
			'destination', createDirectPcmExportFixture(plan, {
				encoderFinalByteLength: plan.outputFileBytesPerRender,
			}),
			createPreparedStream({ reportedByteLength: 3 }), 0, 1,
		],
		[
			'committed', createDirectPcmExportFixture(plan, {
				encoderFinalByteLength: plan.outputFileBytesPerRender,
			}),
			createPreparedStream({ reportedByteLength: plan.outputFileBytesPerRender, publishedSize: 3 }), 1, 0,
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
	const plan = exactDirectBwfPlan({
		outputFrames: Math.ceil((2 * DIRECT_PCM_DESTINATION_WRITE_BYTES) / 6) + 1,
	});
	const plannedBytes = plan.outputFileBytesPerRender;
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

function largestExactBwfPlan(): BwfPlan {
	let lowerFrames = 0;
	let upperFrames = Math.floor(DIRECT_BWF_MAXIMUM_FILE_BYTES / 6) + 1;
	while (lowerFrames < upperFrames) {
		const candidate = Math.ceil((lowerFrames + upperFrames) / 2);
		const candidateBytes = wavLayout(directBwfPlan({ outputFrames: candidate })).byteLength;
		if (candidateBytes <= DIRECT_BWF_MAXIMUM_FILE_BYTES) lowerFrames = candidate;
		else upperFrames = candidate - 1;
	}
	return exactDirectBwfPlan({ outputFrames: lowerFrames });
}

function wavLayout(plan: BwfPlan): ReturnType<typeof inspectWavLayout> {
	return inspectWavLayout({
		container: 'auto',
		sampleRate: plan.sampleRate,
		channelCount: plan.channelCount,
		totalFrames: plan.outputFrames,
		bitDepth: plan.encoding.bitDepth as 16 | 20 | 24,
		float: false,
		metadata: plan.metadata,
		markers: plan.markers,
		ixml: plan.ixml,
		cart: plan.cart,
		bext: plan.bext,
	});
}

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
