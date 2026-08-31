/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	admBedChannelOrder,
	normalizeAdmProjectMetadata,
	type AdmAuthoredMetadata,
	type AdmBedLayout,
} from '../src/common/editor/adm-project-metadata.ts';
import { createAdmChna, createRiffAxmlChunk, createRiffChnaChunk } from '../src/common/editor/adm-metadata.ts';
import { normalizeBextMetadata, createRiffBextChunk, type BextMetadata } from '../src/common/editor/broadcast-wave.ts';
import type { CartMetadataInput } from '../src/common/editor/cart-metadata.ts';
import {
	DIRECT_BW64_MAXIMUM_FILE_BYTES,
	prepareDirectBw64Destination,
} from '../src/common/editor/controller/direct-bw64-export.ts';
import { createEditorExportService, type ExportServiceRuntime } from '../src/common/editor/controller/export-service.ts';
import {
	DIRECT_PCM_DESTINATION_WRITE_BYTES,
	DIRECT_PCM_RENDER_CHUNK_FRAMES,
	directPcmMaximumPendingChunks,
} from '../src/common/editor/controller/direct-pcm-export.ts';
import { normalizeMediaChannelMapping } from '../src/common/editor/media-export.js';
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

interface Bw64AdmPlan {
	readonly mode: 'authored';
	readonly metadata: AdmAuthoredMetadata;
	readonly channelCount: number;
	readonly channelOrder: readonly string[];
	readonly preDataChunks: Uint8Array;
	readonly trailingChunks: Uint8Array;
}

interface Bw64Plan extends TestPlan {
	adm: Bw64AdmPlan;
	bext: BextMetadata;
	container: 'bw64';
	metadata: Readonly<Record<string, string>>;
	markers: readonly RiffMarkerInput[];
	ixml: IxmlMetadataInput | null;
	cart: CartMetadataInput | null;
	preDataChunks: Uint8Array;
	trailingChunks: Uint8Array;
	outputFrames: number;
	outputFileBytesPerRender: number;
}

const BEXT = normalizeBextMetadata({
	description: 'Direct authored ADM master',
	originator: 'Soundscaper',
	timeReference: '96000',
	codingHistory: 'A=PCM,F=48000,W=24,M=stereo,T=Soundscaper\n',
}, { version: 2 });

test('direct BW64 admission is closed over exact authored integer ADM plans', async () => {
	const valid = directBw64Plan();
	const opaque = riffChunk('junk', Uint8Array.of(1));
	const passthrough = Object.freeze({
		mode: 'passthrough', valid: true,
		geometry: { channelCount: 2 },
	});
	const forgedMapping = {
		...valid.channelMapping,
		channels: [{ inputs: [{ channel: 1, gain: 1 }] }, { inputs: [{ channel: 0, gain: 1 }] }],
	};
	for (const candidate of [
		{ ...directPlan(), format: 'bw64' },
		{ ...valid, format: 'wav' },
		{ ...valid, format: 'bwf' },
		{ ...valid, mimeType: 'audio/x-wav' },
		{ ...valid, mode: 'stems' },
		{ ...valid, outputs: [...valid.outputs, { fileName: 'other.wav', trackId: 'other' }] },
		{ ...valid, outputs: [{ fileName: 'mix.bw64', trackId: 'track' }] },
		{ ...valid, outputFileBytesPerRender: null },
		{ ...valid, outputFileBytesPerRender: 0 },
		{ ...valid, outputFileBytesPerRender: 1.5 },
		{ ...valid, outputFileBytesPerRender: Number.MAX_SAFE_INTEGER + 1 },
		{ ...valid, outputFileBytesPerRender: DIRECT_BW64_MAXIMUM_FILE_BYTES + 1 },
		{ ...valid, outputFileBytesPerRender: valid.outputFileBytesPerRender + 2 },
		{ ...valid, render: { strategy: 'offline' } },
		{ ...valid, container: 'auto' },
		{ ...valid, sampleRate: 48_000.5 },
		{ ...valid, outputFrames: -1 },
		{ ...valid, metadata: [] },
		{ ...valid, markers: {} },
		{ ...valid, ixml: 'forged' },
		{ ...valid, cart: 'forged' },
		{ ...valid, encoding: { ...valid.encoding, bitDepth: 32, sampleFormat: 'int32' } },
		{ ...valid, encoding: { ...valid.encoding, floatingPoint: true, sampleFormat: 'float32' } },
		{ ...valid, encoding: { ...valid.encoding, sampleFormat: 'int20' } },
		{ ...valid, channelMapping: { mode: 'preserve' } },
		{ ...valid, channelMapping: forgedMapping },
		{ ...valid, adm: undefined },
		{ ...valid, adm: passthrough },
		{ ...valid, adm: { ...valid.adm, extra: true } },
		{ ...valid, adm: { ...valid.adm, metadata: { ...valid.adm.metadata, extra: true } } },
		{ ...valid, adm: { ...valid.adm, channelCount: 1 } },
		{ ...valid, adm: { ...valid.adm, channelOrder: [...valid.adm.channelOrder].reverse() } },
		{ ...valid, adm: { ...valid.adm, preDataChunks: opaque } },
		{ ...valid, adm: { ...valid.adm, trailingChunks: opaque } },
		{ ...valid, preDataChunks: [valid.preDataChunks, opaque] },
		{ ...valid, trailingChunks: [valid.trailingChunks, opaque] },
		{ ...valid, bext: { description: BEXT.description } },
		{ ...valid, bext: { ...BEXT, unexpected: true } },
		{ ...valid, encoding: { ...valid.encoding, bext: { ...BEXT, description: 'different' } } },
	] satisfies Readonly<Record<string, unknown>>[]) {
		let prepareCalls = 0;
		const preparation = await prepareDirectBw64Destination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, candidate, {}, new AbortController().signal);
		assert.equal(prepareCalls, 0, JSON.stringify({ format: candidate.format, output: candidate.outputFileBytesPerRender }));
		assert.deepEqual(preparation, { cancelled: null, destination: null });
	}

	// The immersive layouts render through the ordinary offline export. This route
	// is the packaged direct stream, whose evidence names mono, stereo and 5.1 and
	// says in as many words that it does not qualify other ADM layouts. Growing the
	// authored bed set must not enrol a layout here that nothing has ever measured.
	for (const layout of ['5.1.2', '5.1.4', '7.1', '7.1.4'] as const) {
		let prepareCalls = 0;
		const preparation = await prepareDirectBw64Destination({
			prepareSave() {
				prepareCalls += 1;
				return Object.freeze({ mode: 'blob' });
			},
		}, directBw64Plan({ layout }), {}, new AbortController().signal);
		assert.equal(prepareCalls, 0, layout);
		assert.deepEqual(preparation, { cancelled: null, destination: null });
	}

	assert.equal(DIRECT_BW64_MAXIMUM_FILE_BYTES, 69_793_218_560);
	for (const layout of ['mono', 'stereo', '5.1'] as const) {
		for (const bitDepth of [16, 20, 24] as const) {
			let prepareCalls = 0;
			await prepareDirectBw64Destination({
				prepareSave() {
					prepareCalls += 1;
					return Object.freeze({ mode: 'blob' });
				},
			}, directBw64Plan({ layout, bitDepth }), {}, new AbortController().signal);
			assert.equal(prepareCalls, 1, `${layout}:int${String(bitDepth)}`);
		}
	}
});

test('direct BW64 exact preparation covers standard RIFF metadata geometry and picker cancellation', async () => {
	const plan = directBw64Plan({
		metadata: Object.freeze({ artist: 'Soundscaper' }),
		markers: Object.freeze([{ id: 1, sampleOffset: 0, label: 'Start' }]),
		ixml: Object.freeze({ project: 'ADM Master' }),
		cart: Object.freeze({ title: 'ADM Master' }),
	});
	const requests: Array<Readonly<Record<string, unknown>>> = [];
	const signal = new AbortController().signal;
	const cancelled = Object.freeze({ mode: 'cancelled', reason: 'picker' });
	const preparation = await prepareDirectBw64Destination({
		prepareSave(request) {
			requests.push(request);
			return cancelled;
		},
	}, plan, { saveTarget: { id: 'native' }, useFileSystemAccess: true }, signal);

	assert.equal(plan.outputFileBytesPerRender, wavLayout(plan).byteLength);
	assert.deepEqual(preparation, { cancelled, destination: null });
	assert.deepEqual(requests, [{
		purpose: 'audio-pcm-mix',
		suggestedName: 'mix.wav',
		mimeType: 'audio/wav',
		target: { id: 'native' },
		types: [{ description: 'BW64 / ADM audio', accept: { 'audio/wav': ['.wav'] } }],
		useFileSystemAccess: true,
		signal,
	}]);
});

test('exact authored BW64 streams ds64, BEXT, CHNA, PCM, and AXML in canonical order', async () => {
	const plan = directBw64Plan({ layout: '5.1' });
	const layout = wavLayout(plan);
	const fixture = createDirectPcmExportFixture(plan, { inputChannelCount: 6 });
	const destination = createPreparedStream({ publishedSize: layout.byteLength });
	fixture.setPrepared(destination.prepared);
	const encoderOptions: Array<Readonly<Record<string, unknown>>> = [];
	const runtime: ExportServiceRuntime = {
		...fixture.runtime,
		createWavStreamEncoder(options: Parameters<typeof createWavStreamEncoder>[0]) {
			encoderOptions.push(options);
			return createWavStreamEncoder(options);
		},
	};
	const result = await createEditorExportService(runtime).handleExportAction('export', {
		saveTarget: { id: 'target' },
		useFileSystemAccess: true,
	});
	const bytes = joinBytes(destination.chunks);
	const view = byteView(bytes);
	const bext = createRiffBextChunk(BEXT);
	const formatOffset = 48 + bext.byteLength;
	const chnaOffset = formatOffset + 24;
	const dataOffset = chnaOffset + plan.preDataChunks.byteLength;
	const axmlOffset = dataOffset + 8 + layout.dataByteLength + layout.dataPadByteLength;

	assert.equal(textAt(bytes, 0), 'BW64');
	assert.equal(view.getUint32(4, true), 0xffff_ffff);
	assert.equal(textAt(bytes, 8), 'WAVE');
	assert.equal(textAt(bytes, 12), 'ds64');
	assert.equal(view.getBigUint64(20, true), BigInt(layout.riffSize));
	assert.equal(view.getBigUint64(28, true), BigInt(layout.dataByteLength));
	assert.equal(view.getBigUint64(36, true), 0n);
	assert.deepEqual(bytes.subarray(48, 48 + bext.byteLength), bext);
	assert.equal(textAt(bytes, formatOffset), 'fmt ');
	assert.equal(textAt(bytes, chnaOffset), 'chna');
	assert.deepEqual(bytes.subarray(chnaOffset, dataOffset), plan.preDataChunks);
	assert.equal(textAt(bytes, dataOffset), 'data');
	assert.equal(view.getUint32(dataOffset + 4, true), 0xffff_ffff);
	assert.equal(textAt(bytes, axmlOffset), 'axml');
	assert.deepEqual(bytes.subarray(axmlOffset), plan.trailingChunks);
	assert.equal(bytes.byteLength, layout.byteLength);
	assert.deepEqual(encoderOptions[0]?.bext, BEXT);
	assert.equal(encoderOptions[0]?.container, 'bw64');
	assert.deepEqual(encoderOptions[0]?.preDataChunks, plan.preDataChunks);
	assert.deepEqual(encoderOptions[0]?.trailingChunks, plan.trailingChunks);
	assert.deepEqual(destination.admissions, [[layout.byteLength, 'exact']]);
	assert.ok(destination.chunks.every((chunk) => chunk.byteLength <= DIRECT_PCM_DESTINATION_WRITE_BYTES));
	assert.equal(destination.prepared.bytesWritten(), layout.byteLength);
	assert.equal(destination.closeCalls(), 1);
	assert.equal(destination.commitCalls(), 1);
	assert.equal(destination.abortCalls(), 0);
	assert.deepEqual(fixture.preflights, []);
	assert.equal(fixture.calls.includes('temporary:create'), false);
	assert.deepEqual(fixture.downloads, []);
	assert.equal(fixture.renderRequests[0]?.chunkFrames, DIRECT_PCM_RENDER_CHUNK_FRAMES);
	assert.equal(fixture.renderRequests[0]?.maximumPendingChunks, directPcmMaximumPendingChunks(6, 'BW64'));
	assert.equal(fixture.renderRequests[0]?.backpressureHighWaterChunks, 1);
	assert.deepEqual(result, {
		url: null, fileName: 'direct.wav', mimeType: 'audio/wav',
		size: layout.byteLength, method: 'file-system-access',
	});
});

test('realtime BW64 loudness measurement fails closed before target, preflight, or render work', async () => {
	const fixture = createDirectPcmExportFixture(directBw64Plan());
	const destination = createPreparedStream();
	fixture.setPrepared(destination.prepared);
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export', {
		measureLoudness: true,
	});

	assert.equal(result, undefined);
	assert.match((fixture.errors[0] as Error).message, /realtime BW64 loudness measurement.*not supported/iu);
	assert.deepEqual(fixture.prepareRequests, []);
	assert.deepEqual(fixture.preflights, []);
	assert.deepEqual(fixture.renderRequests, []);
	assert.equal(destination.admissions.length, 0);
	assert.equal(fixture.calls.includes('temporary:create'), false);
});

test('realtime BW64 loudness measurement refuses immersive beds before direct-route admission', async () => {
	for (const layout of ['5.1.2', '5.1.4', '7.1', '7.1.4'] as const) {
		let prepareCalls = 0;
		await assert.rejects(
			prepareDirectBw64Destination({
				prepareSave() {
					prepareCalls += 1;
					return Object.freeze({ mode: 'blob' });
				},
			}, directBw64Plan({ layout }), { measureLoudness: true }, new AbortController().signal),
			/realtime BW64 loudness measurement.*not supported/iu,
			layout,
		);
		assert.equal(prepareCalls, 0, layout);
	}
});

test('direct BW64 four-way byte diagnostics use the BW64 container label', async () => {
	const plan = directBw64Plan();
	for (const [label, fixture, destination, expectedCommitCalls, expectedAbortCalls] of [
		['encoder', createDirectPcmExportFixture(plan, { encoderFinalByteLength: 3 }), createPreparedStream(), 0, 1],
		['destination', createDirectPcmExportFixture(plan, {
			encoderFinalByteLength: plan.outputFileBytesPerRender,
		}), createPreparedStream({ reportedByteLength: 3 }), 0, 1],
		['committed', createDirectPcmExportFixture(plan, {
			encoderFinalByteLength: plan.outputFileBytesPerRender,
		}), createPreparedStream({
			reportedByteLength: plan.outputFileBytesPerRender,
			publishedSize: 3,
		}), 1, 0],
	] as const) {
		fixture.setPrepared(destination.prepared);
		assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export'), undefined);
		assert.equal(destination.commitCalls(), expectedCommitCalls, `${label} commit count`);
		assert.equal(destination.abortCalls(), expectedAbortCalls, `${label} abort count`);
		assert.match((fixture.errors[0] as Error).message, new RegExp(`${label}.*BW64|BW64.*${label}`, 'iu'));
	}
});

test('mid-stream direct BW64 cancellation aborts without close, commit, Blob, or publication', async () => {
	const writeStarted = deferred();
	const releaseWrite = deferred();
	const plan = directBw64Plan({
		outputFrames: Math.ceil((2 * DIRECT_PCM_DESTINATION_WRITE_BYTES) / 6) + 1,
	});
	const fixture = createDirectPcmExportFixture(plan, {
		encoderFinalByteLength: plan.outputFileBytesPerRender,
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
	assert.equal(destination.closeCalls(), 0);
	assert.equal(destination.commitCalls(), 0);
	assert.equal(destination.abortCalls(), 1);
	assert.equal(fixture.calls.includes('temporary:create'), false);
	assert.deepEqual(fixture.downloads, []);
	assert.equal(fixture.state.exportOutput, null);
});

function directBw64Plan(options: Readonly<{
	layout?: AdmBedLayout;
	bitDepth?: 16 | 20 | 24;
	outputFrames?: number;
	metadata?: Readonly<Record<string, string>>;
	markers?: readonly RiffMarkerInput[];
	ixml?: IxmlMetadataInput | null;
	cart?: CartMetadataInput | null;
}> = {}): Bw64Plan {
	const layout = options.layout ?? 'stereo';
	const bitDepth = options.bitDepth ?? 24;
	const metadata = authoredMetadata(layout);
	const channelOrder = admBedChannelOrder(layout);
	const preDataChunks = createRiffChnaChunk(createAdmChna({ layout }));
	const trailingChunks = createRiffAxmlChunk({
		programmeName: metadata.programme.name,
		contentName: metadata.content.name,
		programmeLanguage: metadata.programme.language,
		contentLanguage: metadata.content.language,
		bedName: metadata.bed.name,
		layout,
	});
	const channelCount = channelOrder.length;
	const plan = {
		...directPlan(),
		format: 'bw64',
		container: 'bw64',
		outputFrames: options.outputFrames ?? 2,
		channelCount,
		channelMapping: normalizeMediaChannelMapping(channelCount, 'preserve'),
		bext: BEXT,
		encoding: Object.freeze({
			bitDepth, floatingPoint: false, sampleFormat: `int${String(bitDepth)}`, bext: BEXT,
		}),
		metadata: options.metadata ?? Object.freeze({}),
		markers: options.markers ?? Object.freeze([]),
		ixml: options.ixml ?? null,
		cart: options.cart ?? null,
		preDataChunks,
		trailingChunks,
		adm: Object.freeze({
			mode: 'authored' as const, metadata, channelCount,
			channelOrder, preDataChunks, trailingChunks,
		}),
	} as Bw64Plan;
	return { ...plan, outputFileBytesPerRender: wavLayout(plan).byteLength };
}

function authoredMetadata(layout: AdmBedLayout): AdmAuthoredMetadata {
	const assignments = admBedChannelOrder(layout).map((bedChannel, sourceChannel) => ({
		stripKind: 'track' as const,
		stripId: 'track',
		sourceChannel,
		bedChannel,
		gain: 1,
	}));
	const normalized = normalizeAdmProjectMetadata({
		mode: 'authored',
		programme: { name: 'Programme', language: 'en' },
		content: { name: 'Main', language: 'en' },
		bed: { name: 'Main Bed', layout, assignments },
	});
	if (normalized.mode !== 'authored') throw new Error('Expected authored ADM metadata.');
	return normalized;
}

function wavLayout(plan: Bw64Plan): ReturnType<typeof inspectWavLayout> {
	return inspectWavLayout({
		container: plan.container,
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
		preDataChunks: plan.preDataChunks,
		trailingChunks: plan.trailingChunks,
	});
}

function riffChunk(id: string, payload: Uint8Array): Uint8Array {
	const bytes = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	bytes.set(new TextEncoder().encode(id));
	new DataView(bytes.buffer).setUint32(4, payload.byteLength, true);
	bytes.set(payload, 8);
	return bytes;
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

function byteView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function textAt(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}
