/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAdmChna,
	encodeChnaPayload,
	generateAdmAxml,
	parseRiffAxmlChunk,
	parseRiffChnaChunk,
} from '../src/common/editor/adm-metadata.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createAudioEditorProjectV7 } from '../src/common/editor/project-v7.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const NOW = '2026-07-28T12:00:00.000Z';

test('authored BW64 plans validate routing and derive a 5.1 ADM bed with BEXT v2', () => {
	const layout = '5.1';
	const channelOrder = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] as const;
	const project = createAudioEditorProjectV7({
		id: 'authored-adm',
		title: 'Drama master',
		now: NOW,
		masterChannels: 2,
		sources: [{
			id: 'source', storageKey: 'pcm/source', name: 'Six channel mix', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 6, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4 }],
		tracks: [{ type: 'audio', id: 'bed', name: 'Bed', clipIds: ['clip'] }],
		mixer: { sends: [{ id: 'surround-fx', name: 'Surround FX' }] },
		metadata: {
			adm: {
				mode: 'authored',
				programme: { name: 'Drama', language: 'en-GB' },
				content: { name: 'Main mix', language: 'fr-FR' },
				bed: {
					name: '5.1 bed',
					layout,
					assignments: channelOrder.flatMap((bedChannel, sourceChannel) => ([
						{ stripKind: 'track' as const, stripId: 'bed', sourceChannel, bedChannel },
						{ stripKind: 'send' as const, stripId: 'surround-fx', sourceChannel, bedChannel },
					])),
				},
			},
		},
	});

	const plan = createExportPlan(project, {
		format: 'bw64',
		adm: project.metadata.adm,
		dither: 'none',
		date: '2026-07-28',
		productName: 'Soundscaper',
	});

	assert.equal(plan.mode, 'mix');
	assert.equal(plan.format, 'bw64');
	assert.ok(plan.adm && plan.bext && plan.preDataChunks && plan.trailingChunks);
	assert.equal(plan.container, 'bw64');
	assert.equal(plan.channelCount, 6);
	assert.deepEqual(plan.adm.channelOrder, channelOrder);
	assert.equal(plan.bext.version, 2);
	assert.equal(plan.bext.codingHistory.endsWith('A=PCM,F=48000,W=24,M=multi,T=Soundscaper\n'), true);
	assert.equal(chunkId(plan.preDataChunks), 'chna');
	assert.equal(chunkId(plan.trailingChunks), 'axml');
	assert.equal(parseRiffChnaChunk(plan.preDataChunks).numTracks, 6);
	const axml = parseRiffAxmlChunk(plan.trailingChunks);
	assert.equal(axml.programmes[0]?.name, 'Drama');
	assert.equal(axml.programmes[0]?.language, 'en-GB');
	assert.equal(axml.contents[0]?.name, 'Main mix');
	assert.equal(axml.contents[0]?.language, 'fr-FR');
	assert.equal(plan.outputFileBytesPerRender, plan.requiredTemporaryBytes);
	const encoded = encodeWav(Array.from({ length: 6 }, () => new Float32Array(4)), {
		container: 'bw64',
		sampleRate: plan.sampleRate,
		bitDepth: 24,
		dither: 'none',
		bext: plan.bext,
		preDataChunks: plan.preDataChunks,
		trailingChunks: plan.trailingChunks,
	});
	assert.equal(chunkId(encoded), 'BW64');
	assert.equal(encoded.byteLength, plan.outputFileBytesPerRender);
	assert.ok(findAscii(encoded, 'chna') < findAscii(encoded, 'data'));
	assert.ok(findAscii(encoded, 'data') < findAscii(encoded, 'axml'));
	const draftPlan = createExportPlan(project, {
		format: 'bw64',
		dither: 'none',
		adm: {
			...project.metadata.adm,
			programme: { name: 'Uncommitted export name', language: 'en-GB' },
		},
	});
	assert.ok(draftPlan.trailingChunks);
	assert.equal(parseRiffAxmlChunk(draftPlan.trailingChunks).programmes[0]?.name, 'Uncommitted export name');
});

test('BW64 authored export rejects stems, missing ADM, mismatched beds, and incomplete routing', () => {
	const project = createAudioEditorProjectV7({
		now: NOW,
		masterChannels: 2,
		sources: [{ id: 'source', storageKey: 'pcm/source', frameCount: 4, channelCount: 2 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4 }],
		tracks: [{ type: 'audio', id: 'bed', clipIds: ['clip'] }],
	});
	assert.throws(() => createExportPlan(project, { format: 'bw64', mode: 'stems' }), /mix-only|mix only/iu);
	assert.throws(() => createExportPlan(project, { format: 'bw64' }), /ADM metadata/iu);

	const incomplete = {
		...project,
		metadata: {
			...project.metadata,
			adm: {
				mode: 'authored' as const,
				programme: { name: 'Programme', language: '' },
				content: { name: 'Content', language: '' },
				bed: {
					name: 'Bed', layout: 'stereo' as const,
					assignments: [{
						stripKind: 'track' as const, stripId: 'bed', sourceChannel: 0,
						bedChannel: 'L' as const, gain: 1,
					}],
				},
			},
		},
	};
	assert.throws(() => createExportPlan(incomplete, { format: 'bw64' }), /ADM routing.*R|bed channel R/iu);
	assert.throws(
		() => createExportPlan({ ...incomplete, masterChannels: 6 }, { format: 'bw64' }),
		/ADM bed.*project master/iu,
	);
	assert.equal(createExportPlan({ ...incomplete, masterChannels: 6 }, {
		format: 'bw64',
		adm: {
			...incomplete.metadata.adm,
			bed: {
				...incomplete.metadata.adm.bed,
				assignments: [
					...incomplete.metadata.adm.bed.assignments,
					{ stripKind: 'track', stripId: 'bed', sourceChannel: 1, bedChannel: 'R', gain: 1 },
				],
			},
		},
	}).channelCount, 2);
});

test('pristine BW64 passthrough preserves raw ADM chunks and rejects stale or changed output', () => {
	const chna = createAdmChna({ layout: 'stereo' });
	const chnaPayload = encodeChnaPayload(chna);
	const axml = generateAdmAxml({ programmeName: 'Imported', layout: 'stereo' });
	const project = createAudioEditorProjectV7({
		id: 'passthrough-adm',
		title: 'Imported master',
		now: NOW,
		revision: 0,
		masterChannels: 2,
		sources: [{
			id: 'source-adm', storageKey: 'pcm/source-adm', name: 'Imported', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 2, sampleRate: 48_000, sampleFormat: 'int24',
		}],
		clips: [{ id: 'clip', sourceId: 'source-adm', durationFrames: 4 }],
		tracks: [{ type: 'audio', id: 'bed', clipIds: ['clip'] }],
		metadata: {
			adm: {
				mode: 'passthrough',
				payload: { kind: 'axml', xml: axml },
				chna: {
					rawBase64: Buffer.from(chnaPayload).toString('base64'),
					entries: chna.entries.map((entry) => ({
						trackIndex: entry.trackIndex,
						audioTrackUid: entry.uid,
						audioTrackFormatIdRef: entry.trackRef,
						audioPackFormatIdRef: entry.packRef,
					})),
				},
				source: { id: 'source-adm', storageKey: 'pcm/source-adm', mimeType: 'audio/wav' },
				geometry: {
					sampleRate: 48_000, channelCount: 2, frameCount: 4, bitDepth: 24, float: false,
				},
				pristineRevision: 0,
				valid: true,
				warnings: [],
			},
		},
	});
	const options = { format: 'bw64', bitDepth: 24, dither: 'none' } as const;
	const plan = createExportPlan(project, options);
	assert.ok(plan.adm && plan.preDataChunks && plan.trailingChunks);
	assert.equal(plan.adm.mode, 'passthrough');
	assert.deepEqual(payload(plan.preDataChunks), chnaPayload);
	assert.equal(new TextDecoder().decode(payload(plan.trailingChunks)), axml);

	assert.throws(
		() => createExportPlan({ ...project, revision: 1 }, options),
		/project-revision-changed|revision changed/iu,
	);
	assert.throws(
		() => createExportPlan(project, { ...options, range: { startFrame: 1, endFrame: 4 } }),
		/range-changed|range changed/iu,
	);
	assert.throws(() => createExportPlan(project, { ...options, sampleRate: 44_100 }), /sample-rate-changed|sample rate changed/iu);
	assert.throws(() => createExportPlan(project, { ...options, bitDepth: 16 }), /bit-depth-changed|bit depth changed/iu);
	assert.throws(() => createExportPlan(project, { ...options, dither: 'triangular' }), /dither/iu);
	assert.throws(() => createExportPlan(project, { ...options, channelMapping: [1, 0] }), /channel mapping|channel order|preserve/iu);
	assert.throws(() => createExportPlan({
		...project,
		sources: project.sources.map((source) => ({ ...source, channelCount: 1 })),
	}, options), /channel-count-changed|channel count changed/iu);
	assert.throws(() => createExportPlan({
		...project,
		sources: project.sources.map((source) => ({ ...source, storageKey: 'pcm/replaced' })),
	}, options), /source-changed|source changed/iu);
});

function chunkId(chunk: Uint8Array): string {
	return new TextDecoder('ascii').decode(chunk.subarray(0, 4));
}

function payload(chunk: Uint8Array): Uint8Array {
	const byteLength = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(4, true);
	return chunk.subarray(8, 8 + byteLength);
}

function findAscii(bytes: Uint8Array, value: string): number {
	const pattern = new TextEncoder().encode(value);
	for (let offset = 0; offset <= bytes.byteLength - pattern.byteLength; offset += 1) {
		if (pattern.every((byte, index) => bytes[offset + index] === byte)) return offset;
	}
	return -1;
}
