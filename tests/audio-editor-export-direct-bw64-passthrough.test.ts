/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdmChna, encodeChnaPayload, generateAdmAxml } from '../src/common/editor/adm-metadata.ts';
import { createRiffBextChunk, normalizeBextMetadata, type BextMetadata } from '../src/common/editor/broadcast-wave.ts';
import { createRiffCartChunk } from '../src/common/editor/cart-metadata.ts';
import { prepareDirectBw64Destination } from '../src/common/editor/controller/direct-bw64-export.ts';
import { createEditorExportService, type ExportServiceRuntime } from '../src/common/editor/controller/export-service.ts';
import { DIRECT_PCM_DESTINATION_WRITE_BYTES } from '../src/common/editor/controller/direct-pcm-export.ts';
import { createImportedAdmPassthroughMetadata } from '../src/common/editor/controller/wav-import-metadata.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createRiffIxmlChunk } from '../src/common/editor/ixml.ts';
import type { ProjectBextMetadataInput } from '../src/common/editor/project-bext-metadata.ts';
import { createAudioEditorProjectV7, type AudioEditorProjectV7 } from '../src/common/editor/project-v7.ts';
import { createRiffMarkerChunks, type RiffMarkerInput } from '../src/common/editor/riff-markers.ts';
import { createWavStreamEncoder, inspectWavLayout } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import {
	createDirectPcmExportFixture,
	createPreparedStream,
	type TestPlan,
} from './helpers/direct-pcm-export-fixture.ts';

const UINT32_SENTINEL = 0xffff_ffff;
const STRUCTURAL_CHUNKS = new Set(['ds64', 'fmt ', 'data']);
const BEXT = normalizeBextMetadata({
	description: 'Pristine imported ADM master',
	originator: 'Field recorder',
	timeReference: '96000',
	codingHistory: 'A=PCM,F=48000,W=16,M=stereo,T=Recorder\n',
}, { version: 2 });

interface PassthroughAdmPlan extends Readonly<Record<string, unknown>> {
	readonly mode: 'passthrough';
	readonly metadata: Readonly<Record<string, unknown>> & {
		readonly riffChunkSequence?: readonly RiffSequenceEntry[];
	};
	readonly channelCount: number;
	readonly channelOrder: readonly string[];
	readonly preDataChunks: Uint8Array | readonly Uint8Array[] | undefined;
	readonly trailingChunks: Uint8Array | readonly Uint8Array[] | undefined;
}

interface PassthroughPlan extends TestPlan {
	adm: PassthroughAdmPlan;
	bext?: BextMetadata;
	container: 'bw64';
	metadata: Readonly<Record<string, string>>;
	markers: readonly RiffMarkerInput[];
	ixml: Readonly<Record<string, unknown>> | null;
	cart: Readonly<Record<string, unknown>> | null;
	preDataChunks: Uint8Array | readonly Uint8Array[];
	trailingChunks: Uint8Array | readonly Uint8Array[];
	outputFileBytesPerRender: number;
}

interface RiffSequenceEntry {
	readonly id: string;
	readonly placement: 'before-data' | 'after-data';
	readonly rawBase64: string;
}

interface PristineFixture {
	readonly plan: PassthroughPlan;
	readonly project: AudioEditorProjectV7;
	readonly sourceSequence: readonly RiffSequenceEntry[];
}

test('current-import pristine BW64 passthrough plans retain an exact bounded sequence and prepare a direct target', async () => {
	for (const preservedBext of [true, false]) {
		const fixture = await pristinePassthroughFixture({ preservedBext });
		const { plan, sourceSequence } = fixture;
		let prepareCalls = 0;
		const signal = new AbortController().signal;
		const cancelled = Object.freeze({ mode: 'cancelled', reason: 'picker' });
		const preparation = await prepareDirectBw64Destination({
			prepareSave(request) {
				prepareCalls += 1;
				assert.deepEqual(request, {
					purpose: 'audio-pcm-mix',
					suggestedName: plan.outputs[0]?.fileName,
					mimeType: 'audio/wav',
					target: { id: 'native' },
					types: [{ description: 'BW64 / ADM audio', accept: { 'audio/wav': ['.wav'] } }],
					useFileSystemAccess: true,
					signal,
				});
				return cancelled;
			},
		}, plan, { saveTarget: { id: 'native' }, useFileSystemAccess: true }, signal);

		assert.equal(plan.adm.mode, 'passthrough');
		assert.deepEqual(plan.adm.metadata.riffChunkSequence, sourceSequence);
		assert.equal(plan.outputFileBytesPerRender, wavLayout(plan).byteLength);
		assert.equal(plan.render.strategy, 'realtime-stream');
		assert.equal(prepareCalls, 1, preservedBext ? 'preserved BEXT' : 'generated BEXT');
		assert.equal(sourceSequence.some(({ id }) => id === 'bext'), preservedBext);
		assert.equal(Object.hasOwn(plan, 'bext'), !preservedBext);
		assert.equal(Object.hasOwn(plan.encoding, 'bext'), !preservedBext);
		assert.deepEqual(preparation, { cancelled, destination: null });
	}
});

test('direct passthrough streaming preserves every source chunk byte, placement, and order', async () => {
	const { plan, sourceSequence } = await pristinePassthroughFixture();
	const layout = wavLayout(plan);
	const fixture = createDirectPcmExportFixture(plan);
	const destination = createPreparedStream({ publishedSize: layout.byteLength });
	fixture.setPrepared(destination.prepared);
	const encoderOptions: Readonly<Record<string, unknown>>[] = [];
	const runtime: ExportServiceRuntime = {
		...fixture.runtime,
		createWavStreamEncoder(options: Parameters<typeof createWavStreamEncoder>[0]) {
			encoderOptions.push(options);
			return createWavStreamEncoder(options);
		},
	};
	const result = await createEditorExportService(runtime).handleExportAction('export', {
		saveTarget: { id: 'target' }, useFileSystemAccess: true,
	});
	assert.deepEqual(destination.admissions, [[layout.byteLength, 'exact']], 'passthrough must use the direct target');
	const bytes = joinBytes(destination.chunks);
	const chunks = locateBw64Chunks(bytes);
	const dataIndex = chunks.findIndex(({ id }) => id === 'data');
	const actualSequence = chunks.filter(({ id }) => !STRUCTURAL_CHUNKS.has(id));

	assert.deepEqual(actualSequence.map(({ id }) => id), sourceSequence.map(({ id }) => id));
	for (let index = 0; index < sourceSequence.length; index += 1) {
		const expected = sourceSequence[index];
		const actual = actualSequence[index];
		assert.ok(expected && actual);
		assert.deepEqual(bytes.subarray(actual.offset, actual.end), decodeBase64(expected.rawBase64), expected.id);
		assert.equal(actual.index < dataIndex, expected.placement === 'before-data', expected.id);
	}
	assert.equal(bytes.byteLength, layout.byteLength);
	assert.equal(encoderOptions[0]?.bext, undefined, 'preserved BEXT is emitted only from the source sequence');
	assert.deepEqual(encoderOptions[0]?.preDataChunks, plan.preDataChunks);
	assert.deepEqual(encoderOptions[0]?.trailingChunks, plan.trailingChunks);
	assert.ok(destination.chunks.every((chunk) => chunk.byteLength <= DIRECT_PCM_DESTINATION_WRITE_BYTES));
	assert.equal(destination.closeCalls(), 1);
	assert.equal(destination.commitCalls(), 1);
	assert.equal(destination.abortCalls(), 0);
	assert.deepEqual(fixture.preflights, []);
	assert.deepEqual(fixture.downloads, []);
	assert.deepEqual(result, {
		url: null, fileName: 'direct.wav', mimeType: 'audio/wav',
		size: layout.byteLength, method: 'file-system-access',
	});
});

test('a passthrough source without BEXT streams exactly one generated canonical BEXT', async () => {
	const { plan, sourceSequence } = await pristinePassthroughFixture({ preservedBext: false });
	assert.ok(plan.bext);
	const layout = wavLayout(plan);
	const fixture = createDirectPcmExportFixture(plan);
	const destination = createPreparedStream({ publishedSize: layout.byteLength });
	fixture.setPrepared(destination.prepared);
	const runtime: ExportServiceRuntime = {
		...fixture.runtime,
		createWavStreamEncoder,
	};
	await createEditorExportService(runtime).handleExportAction('export');
	assert.deepEqual(destination.admissions, [[layout.byteLength, 'exact']], 'passthrough must use the direct target');
	const bytes = joinBytes(destination.chunks);
	const nonstructural = locateBw64Chunks(bytes).filter(({ id }) => !STRUCTURAL_CHUNKS.has(id));
	const bext = nonstructural.filter(({ id }) => id === 'bext');

	assert.equal(sourceSequence.some(({ id }) => id === 'bext'), false);
	assert.equal(bext.length, 1);
	assert.deepEqual(bytes.subarray(bext[0]?.offset, bext[0]?.end), createRiffBextChunk(plan.bext));
	assert.deepEqual(
		nonstructural.filter(({ id }) => id !== 'bext').map(({ id }) => id),
		sourceSequence.map(({ id }) => id),
	);
	assert.equal(destination.commitCalls(), 1);
});

test('direct passthrough admission rejects incomplete provenance and observable plan drift before target selection', async () => {
	const { plan } = await pristinePassthroughFixture();
	const sequence = plan.adm.metadata.riffChunkSequence ?? [];
	const legacyMetadata = omitKeys(plan.adm.metadata, ['riffChunkSequence']);
	const missingMetadata = omitKeys(legacyMetadata, ['opaqueRiffChunks']);
	const preData = chunkArray(plan.preDataChunks);
	const reordered = Object.freeze([preData[1] as Uint8Array, preData[0] as Uint8Array, ...preData.slice(2)]);
	const changedBytes = preData.map((chunk, index) => index === 0 ? changedLastByte(chunk) : chunk);
	const movedSequence = sequence.map((entry, index) => index === 0
		? { ...entry, placement: 'after-data' as const }
		: entry);
	const swappedOrder = [...plan.adm.channelOrder].reverse();
	const swappedMapping = {
		...plan.channelMapping,
		channels: [{ inputs: [{ channel: 1, gain: 1 }] }, { inputs: [{ channel: 0, gain: 1 }] }],
	};
	const candidates: readonly Readonly<Record<string, unknown>>[] = [
		withAdmMetadata(plan, missingMetadata),
		withAdmMetadata(plan, legacyMetadata),
		withAdmMetadata(plan, { ...plan.adm.metadata, valid: false, warnings: ['invalid ADM'] }),
		withAdmMetadata(plan, { ...plan.adm.metadata, warnings: ['not pristine'] }),
		{ ...plan, preDataChunks: reordered, adm: { ...plan.adm, preDataChunks: reordered } },
		{ ...plan, preDataChunks: changedBytes, adm: { ...plan.adm, preDataChunks: changedBytes } },
		withAdmMetadata(plan, { ...plan.adm.metadata, riffChunkSequence: movedSequence }),
		{ ...plan, channelMapping: swappedMapping },
		{ ...plan, dither: true },
		{ ...plan, ditherMode: 'triangular' },
		{ ...plan, tailFrames: 1 },
		{ ...plan, range: { startFrame: 1, endFrame: plan.outputFrames, durationFrames: plan.outputFrames - 1 } },
		{ ...plan, encoding: { ...plan.encoding, dither: 'triangular' } },
		{ ...plan, encoding: { ...plan.encoding, sampleRate: 44_100 } },
		{ ...plan, channelCount: 1 },
		{ ...plan, adm: { ...plan.adm, channelCount: 1 } },
		{ ...plan, adm: { ...plan.adm, channelOrder: swappedOrder } },
		withAdmMetadata(plan, {
			...plan.adm.metadata,
			geometry: { ...(plan.adm.metadata.geometry as Readonly<Record<string, unknown>>), channelCount: 1 },
		}),
		withAdmMetadata(plan, {
			...plan.adm.metadata,
			geometry: { ...(plan.adm.metadata.geometry as Readonly<Record<string, unknown>>), frameCount: plan.outputFrames + 1 },
		}),
		{ ...plan, outputFileBytesPerRender: plan.outputFileBytesPerRender + 2 },
	];
	for (const [index, candidate] of candidates.entries()) {
		let prepareCalls = 0;
		const preparation = await prepareDirectBw64Destination({
			prepareSave() { prepareCalls += 1; return { mode: 'blob' }; },
		}, candidate, {}, new AbortController().signal);
		assert.equal(prepareCalls, 0, `candidate ${String(index)}`);
		assert.deepEqual(preparation, { cancelled: null, destination: null });
	}
});

test('preserved modeled chunks cannot also be generated by plan fields', async () => {
	const { plan } = await pristinePassthroughFixture();
	const duplicates = [
		recomputeBytes({ ...plan, bext: BEXT, encoding: { ...plan.encoding, bext: BEXT } }),
		{ ...plan, encoding: { ...plan.encoding, bext: BEXT } },
		recomputeBytes({ ...plan, metadata: { artist: 'Duplicate INFO and ID3' } }),
		recomputeBytes({ ...plan, markers: [{ id: 99, sampleOffset: 0, label: 'Duplicate cue' }] }),
		recomputeBytes({ ...plan, ixml: { project: 'Duplicate iXML' } }),
		recomputeBytes({ ...plan, cart: { title: 'Duplicate CART' } }),
	];
	for (const [index, candidate] of duplicates.entries()) {
		let prepareCalls = 0;
		await prepareDirectBw64Destination({
			prepareSave() { prepareCalls += 1; return { mode: 'blob' }; },
		}, candidate, {}, new AbortController().signal);
		assert.equal(prepareCalls, 0, `modeled collision ${String(index)}`);
	}
});

test('stale or edited passthrough projects fail planning before target selection', async () => {
	const { project } = await pristinePassthroughFixture();
	const source = project.sources[0] as Readonly<Record<string, unknown>>;
	const clip = project.clips[0] as Readonly<Record<string, unknown>>;
	for (const candidate of [
		{ ...project, revision: project.revision + 1 },
		{ ...project, sources: [{ ...source, storageKey: 'pcm/replaced' }] },
		{ ...project, clips: [{ ...clip, gain: 0.5 }] },
	]) {
		let prepareCalls = 0;
		assert.throws(() => {
			const plan = createPassthroughPlan(candidate as AudioEditorProjectV7);
			void prepareDirectBw64Destination({
				prepareSave() { prepareCalls += 1; return { mode: 'blob' }; },
			}, plan, {}, new AbortController().signal);
		}, /passthrough|pristine|source|signal path|full-source/iu);
		assert.equal(prepareCalls, 0);
	}
});

test('passthrough loudness measurement fails closed before target selection', async () => {
	const { plan } = await pristinePassthroughFixture();
	let prepareCalls = 0;
	await assert.rejects(
		prepareDirectBw64Destination({
			prepareSave() { prepareCalls += 1; return { mode: 'blob' }; },
		}, plan, { measureLoudness: true }, new AbortController().signal),
		/realtime BW64 loudness measurement.*not supported/iu,
	);
	assert.equal(prepareCalls, 0);
});

async function pristinePassthroughFixture(
	options: Readonly<{ preservedBext: boolean }> = { preservedBext: true },
): Promise<PristineFixture> {
	const source = sourceBw64(options);
	const descriptor = await inspectWavBlobPcm(source.blob);
	assert.equal(descriptor.adm?.valid, true);
	assert.deepEqual(descriptor.adm?.riffChunkSequence, source.sequence);
	const projectBeforeImport = Object.freeze({ revision: 0 });
	const storedSource = {
		id: 'source', storageKey: 'pcm/source', name: 'Imported ADM bed', mimeType: 'audio/wav',
		frameCount: descriptor.frameCount, channelCount: descriptor.channelCount,
		sampleRate: descriptor.sampleRate, sampleFormat: 'float32',
	};
	const importedAdm = createImportedAdmPassthroughMetadata({
		candidate: descriptor.adm,
		source: storedSource,
		descriptor,
		project: projectBeforeImport,
	});
	assert.ok(importedAdm?.mode === 'passthrough');
	assert.ok(descriptor.bext == null || descriptor.bext.version === 2);
	const project = createAudioEditorProjectV7({
		id: 'pristine-import', title: 'Pristine import', revision: 1,
		now: '2026-07-30T12:00:00.000Z', masterChannels: descriptor.channelCount,
		sources: [storedSource],
		clips: [{ id: 'clip', sourceId: storedSource.id, durationFrames: descriptor.frameCount }],
		tracks: [{ id: 'bed', type: 'audio', name: 'ADM bed', clipIds: ['clip'] }],
		metadata: {
			adm: importedAdm,
			bext: descriptor.bext as ProjectBextMetadataInput | null,
			ixml: descriptor.ixml ?? null,
			cart: descriptor.cart ?? null,
		},
	});
	const plan = createPassthroughPlan(project);
	assert.equal(plan.adm?.mode, 'passthrough');
	return { plan, project, sourceSequence: source.sequence };
}

function sourceBw64(options: Readonly<{ preservedBext: boolean }>): Readonly<{
	blob: Blob;
	sequence: readonly RiffSequenceEntry[];
}> {
	const markerChunks = splitCompleteRiffChunks(createRiffMarkerChunks([{
		id: 7, sampleOffset: 1, sampleLength: 1, label: 'Slate', note: 'Imported marker',
	}]));
	const before = [
		riffChunk('JUNK', Uint8Array.of(1, 2, 3), false, 0xa5),
		...(options.preservedBext ? [createRiffBextChunk(BEXT)] : []),
		riffChunk('chna', encodeChnaPayload(createAdmChna({ layout: 'stereo' }))),
		...markerChunks,
		createRiffIxmlChunk({ project: 'Imported production' }),
		createRiffCartChunk({ title: 'Imported cart' }),
		riffChunk('LIST', listPayload('INFO', [
			riffChunk('IENG', new TextEncoder().encode('Mixer\0')),
		])),
	];
	const after = [
		riffChunk('PEAK', Uint8Array.of(9, 8, 7), false, 0x5a),
		riffChunk('axml', new TextEncoder().encode(generateAdmAxml({
			programmeName: 'Imported programme', layout: 'stereo',
		}))),
		riffChunk('id3 ', Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0)),
	];
	const blob = createBw64(before, after);
	return {
		blob,
		sequence: Object.freeze([
			...before.map((raw) => sequenceEntry(raw, 'before-data')),
			...after.map((raw) => sequenceEntry(raw, 'after-data')),
		]),
	};
}

function createBw64(before: readonly Uint8Array[], after: readonly Uint8Array[]): Blob {
	const dataBytes = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0);
	const ds64 = riffChunk('ds64', new Uint8Array(28));
	const format = riffChunk('fmt ', formatPayload());
	const data = riffChunk('data', dataBytes, true);
	const byteLength = 12 + [ds64, format, ...before, data, ...after]
		.reduce((size, chunk) => size + chunk.byteLength, 0);
	const output = new Uint8Array(byteLength);
	const view = new DataView(output.buffer);
	writeAscii(output, 0, 'BW64');
	view.setUint32(4, UINT32_SENTINEL, true);
	writeAscii(output, 8, 'WAVE');
	let offset = 12;
	output.set(ds64, offset);
	view.setBigUint64(offset + 8, BigInt(byteLength - 8), true);
	view.setBigUint64(offset + 16, BigInt(dataBytes.byteLength), true);
	offset += ds64.byteLength;
	for (const chunk of [format, ...before, data, ...after]) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new Blob([output], { type: 'audio/wav' });
}

function wavLayout(plan: PassthroughPlan): ReturnType<typeof inspectWavLayout> {
	return inspectWavLayout({
		container: 'bw64',
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

function createPassthroughPlan(project: AudioEditorProjectV7): PassthroughPlan {
	return createExportPlan(project, {
		format: 'bw64', bitDepth: 16, dither: 'none', includeTail: false,
		mobile: true, livePcmBytes: 321 * 1024 ** 2,
		date: '2026-07-30', productName: 'Soundscaper',
	}) as unknown as PassthroughPlan;
}

function withAdmMetadata(
	plan: PassthroughPlan,
	metadata: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return { ...plan, adm: { ...plan.adm, metadata } };
}

function omitKeys(
	value: Readonly<Record<string, unknown>>,
	keys: readonly string[],
): Readonly<Record<string, unknown>> {
	return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function chunkArray(value: Uint8Array | readonly Uint8Array[]): readonly Uint8Array[] {
	return value instanceof Uint8Array ? [value] : value;
}

function changedLastByte(value: Uint8Array): Uint8Array {
	const changed = value.slice();
	changed[changed.byteLength - 1] ^= 1;
	return changed;
}

function recomputeBytes(candidate: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	const plan = candidate as unknown as PassthroughPlan;
	return { ...candidate, outputFileBytesPerRender: wavLayout(plan).byteLength };
}

interface RiffLocation {
	readonly id: string;
	readonly index: number;
	readonly offset: number;
	readonly end: number;
}

function locateBw64Chunks(bytes: Uint8Array): readonly RiffLocation[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const dataBytes = Number(view.getBigUint64(28, true));
	const result: RiffLocation[] = [];
	let offset = 12;
	while (offset < bytes.byteLength) {
		const id = ascii(bytes, offset, 4);
		const declared = view.getUint32(offset + 4, true);
		const payloadBytes = id === 'data' && declared === UINT32_SENTINEL ? dataBytes : declared;
		const end = offset + 8 + payloadBytes + (payloadBytes & 1);
		result.push({ id, index: result.length, offset, end });
		offset = end;
	}
	assert.equal(offset, bytes.byteLength);
	return result;
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	return output;
}

function decodeBase64(value: string): Uint8Array {
	return Uint8Array.from(Buffer.from(value, 'base64'));
}

function sequenceEntry(raw: Uint8Array, placement: RiffSequenceEntry['placement']): RiffSequenceEntry {
	return Object.freeze({
		id: ascii(raw, 0, 4),
		placement,
		rawBase64: Buffer.from(raw).toString('base64'),
	});
}

function formatPayload(): Uint8Array {
	const output = new Uint8Array(16);
	const view = new DataView(output.buffer);
	view.setUint16(0, 1, true);
	view.setUint16(2, 2, true);
	view.setUint32(4, 48_000, true);
	view.setUint32(8, 192_000, true);
	view.setUint16(12, 4, true);
	view.setUint16(14, 16, true);
	return output;
}

function listPayload(kind: string, chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(4 + chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
	writeAscii(output, 0, kind);
	let offset = 4;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function riffChunk(id: string, payload: Uint8Array, sentinel = false, padByte = 0): Uint8Array {
	const output = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	writeAscii(output, 0, id);
	new DataView(output.buffer).setUint32(4, sentinel ? UINT32_SENTINEL : payload.byteLength, true);
	output.set(payload, 8);
	if (payload.byteLength & 1) output[output.byteLength - 1] = padByte;
	return output;
}

function splitCompleteRiffChunks(bytes: Uint8Array): readonly Uint8Array[] {
	const result: Uint8Array[] = [];
	let offset = 0;
	while (offset < bytes.byteLength) {
		const payloadBytes = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
		const end = offset + 8 + payloadBytes + (payloadBytes & 1);
		result.push(bytes.slice(offset, end));
		offset = end;
	}
	assert.equal(offset, bytes.byteLength);
	return Object.freeze(result);
}

function writeAscii(output: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) output[offset + index] = value.charCodeAt(index);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
