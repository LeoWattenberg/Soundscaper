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
		mixer: {
			sends: [{ id: 'surround-fx', name: 'Surround FX' }],
			routes: { bed: { sends: { 'surround-fx': 1 } } },
		},
		metadata: {
			adm: {
				mode: 'authored',
				programme: { name: 'Drama', language: 'eng' },
				content: { name: 'Main mix', language: 'fra' },
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
	assert.ok(plan.preDataChunks instanceof Uint8Array);
	assert.ok(plan.trailingChunks instanceof Uint8Array);
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
	assert.equal(axml.programmes[0]?.language, 'eng');
	assert.equal(axml.contents[0]?.name, 'Main mix');
	assert.equal(axml.contents[0]?.language, 'fra');
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
			programme: { name: 'Uncommitted export name', language: 'eng' },
		},
	});
	assert.ok(draftPlan.trailingChunks instanceof Uint8Array);
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
	const axmlBytes = new Uint8Array(3 + new TextEncoder().encode(axml).byteLength);
	axmlBytes.set([0xef, 0xbb, 0xbf]);
	axmlBytes.set(new TextEncoder().encode(axml), 3);
	const serialPayload = sxmlPayload(4);
	const auxiliaryBxml = Uint8Array.from([0, 0, ...new TextEncoder().encode('<vendorMetadata />')]);
	const opaqueBefore = [
		riffChunk('JUNK', Uint8Array.of(1, 2, 3), 0xa5),
		riffChunk('LIST', Uint8Array.of(0x56, 0x45, 0x4e, 0x44, 9)),
	];
	const opaqueAfter = [
		riffChunk('PEAK', Uint8Array.of(4, 5, 6), 0x7f),
		riffChunk('MD5 ', Uint8Array.of(7, 8)),
	];
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
				payload: { kind: 'axml', xml: axml, rawBase64: Buffer.from(axmlBytes).toString('base64') },
				serialPayload: { kind: 'sxml', base64: Buffer.from(serialPayload).toString('base64') },
				auxiliaryPayloads: [{ kind: 'bxml', base64: Buffer.from(auxiliaryBxml).toString('base64') }],
				opaqueRiffChunks: [
					...opaqueBefore.map((raw) => ({
						id: chunkId(raw), placement: 'before-data' as const, rawBase64: Buffer.from(raw).toString('base64'),
					})),
					...opaqueAfter.map((raw) => ({
						id: chunkId(raw), placement: 'after-data' as const, rawBase64: Buffer.from(raw).toString('base64'),
					})),
				],
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
	const passthroughAdm = project.metadata.adm;
	assert.ok(passthroughAdm?.mode === 'passthrough');
	const options = { format: 'bw64', bitDepth: 24, dither: 'none' } as const;
	const plan = createExportPlan(project, options);
	assert.ok(plan.adm && plan.preDataChunks && plan.trailingChunks);
	assert.equal(plan.adm.mode, 'passthrough');
	assert.ok(Array.isArray(plan.preDataChunks));
	assert.deepEqual(plan.preDataChunks.slice(0, 2), opaqueBefore);
	assert.deepEqual(payload(plan.preDataChunks[2]), chnaPayload);
	assert.ok(Array.isArray(plan.trailingChunks));
	assert.equal(chunkId(plan.trailingChunks[0]), 'axml');
	assert.deepEqual(payload(plan.trailingChunks[0]), axmlBytes);
	assert.equal(chunkId(plan.trailingChunks[1]), 'bxml');
	assert.deepEqual(payload(plan.trailingChunks[1]), auxiliaryBxml);
	assert.equal(chunkId(plan.trailingChunks[2]), 'sxml');
	assert.deepEqual(payload(plan.trailingChunks[2]), serialPayload);
	assert.deepEqual(plan.trailingChunks.slice(3), opaqueAfter);
	const encoded = encodeWav([new Float32Array(4), new Float32Array(4)], {
		container: 'bw64', sampleRate: 48_000, bitDepth: 24, dither: 'none',
		preDataChunks: plan.preDataChunks, trailingChunks: plan.trailingChunks,
	});
	assert.ok(findAscii(encoded, 'JUNK') < findAscii(encoded, 'LIST'));
	assert.ok(findAscii(encoded, 'LIST') < findAscii(encoded, 'chna'));
	assert.ok(findAscii(encoded, 'chna') < findAscii(encoded, 'data'));
	assert.ok(findAscii(encoded, 'data') < findAscii(encoded, 'axml'));
	assert.ok(findAscii(encoded, 'sxml') < findAscii(encoded, 'PEAK'));
	assert.ok(findAscii(encoded, 'PEAK') < findAscii(encoded, 'MD5 '));
	const structural = riffChunk('data', Uint8Array.of(1, 2));
	assert.throws(() => createAudioEditorProjectV7({
		...project,
		metadata: { ...project.metadata, adm: {
			...passthroughAdm,
			opaqueRiffChunks: [{
				id: 'data', placement: 'after-data', rawBase64: Buffer.from(structural).toString('base64'),
			}],
		} },
	}), /duplicates.*structural|modeled.*data/iu);
	const tamperedProject = createAudioEditorProjectV7({
		...project,
		metadata: { ...project.metadata, adm: {
			...passthroughAdm,
			chna: {
				...passthroughAdm.chna,
				rawBase64: Buffer.from(encodeChnaPayload(createAdmChna({ layout: 'mono' }))).toString('base64'),
			},
		} },
	});
	assert.throws(() => createExportPlan(tamperedProject, options), /CHNA.*geometry|CHNA.*disagree/iu);

	const sxml = sxmlPayload(4);
	const sxmlProject = createAudioEditorProjectV7({
		...project,
		metadata: { ...project.metadata, adm: {
			...passthroughAdm,
			payload: { kind: 'sxml', base64: Buffer.from(sxml).toString('base64') },
			serialPayload: undefined,
			auxiliaryPayloads: undefined,
			opaqueRiffChunks: undefined,
			chna: { entries: [], rawBase64: '' },
		} },
	});
	const sxmlPlan = createExportPlan(sxmlProject, options);
	assert.equal(sxmlPlan.preDataChunks, undefined);
	const sxmlChunk = sxmlPlan.trailingChunks;
	assert.ok(sxmlChunk instanceof Uint8Array);
	assert.equal(chunkId(sxmlChunk), 'sxml');
	assert.deepEqual(payload(sxmlChunk), sxml);
	const sxmlAdm = sxmlProject.metadata.adm;
	assert.ok(sxmlAdm?.mode === 'passthrough');
	const repeatedTrackChna = {
		numTracks: 2,
		entries: [
			{ trackIndex: 1, uid: 'ATU_00000001', trackRef: 'AC_00010001', packRef: 'AP_00010002' },
			{ trackIndex: 1, uid: 'ATU_00000003', trackRef: 'AC_00010003', packRef: 'AP_00010002' },
			{ trackIndex: 2, uid: 'ATU_00000002', trackRef: 'AC_00010002', packRef: 'AP_00010002' },
		],
	};
	const repeatedTrackPayload = encodeChnaPayload(repeatedTrackChna);
	const repeatedTrackProject = createAudioEditorProjectV7({
		...sxmlProject,
		metadata: { ...sxmlProject.metadata, adm: {
			...sxmlAdm,
			chna: {
				rawBase64: Buffer.from(repeatedTrackPayload).toString('base64'),
				entries: repeatedTrackChna.entries.map((entry) => ({
					trackIndex: entry.trackIndex,
					audioTrackUid: entry.uid,
					audioTrackFormatIdRef: entry.trackRef,
					audioPackFormatIdRef: entry.packRef,
				})),
			},
		} },
	});
	assert.deepEqual(createExportPlan(repeatedTrackProject, options).adm?.channelOrder, [
		'AC_00010001',
		'AC_00010002',
	]);
	const emptyAxmlProject = createAudioEditorProjectV7({
		...project,
		metadata: { ...project.metadata, adm: {
			...passthroughAdm,
			payload: { kind: 'axml', xml: '', rawBase64: '' },
			serialPayload: undefined,
			auxiliaryPayloads: undefined,
			opaqueRiffChunks: undefined,
		} },
	});
	const emptyAxmlPlan = createExportPlan(emptyAxmlProject, options);
	const emptyAxmlChunk = emptyAxmlPlan.trailingChunks;
	assert.ok(emptyAxmlChunk instanceof Uint8Array);
	assert.equal(chunkId(emptyAxmlChunk), 'axml');
	assert.equal(payload(emptyAxmlChunk).byteLength, 0);

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
	assert.throws(() => createExportPlan({
		...project,
		master: { ...(project.master as Readonly<Record<string, unknown>>), gain: 0.5 },
	}, options), /neutral|signal path/iu);
	for (const [name, clips] of [
		['clip gain', project.clips.map((clip) => ({ ...clip, gain: 0.5 }))],
		['clip fade', project.clips.map((clip) => ({ ...clip, fadeInFrames: 1 }))],
		['clip trim', project.clips.map((clip) => ({ ...clip, trimEndFrames: 1 }))],
		['clip speed', project.clips.map((clip) => ({ ...clip, speedRatio: 2 }))],
		['duplicate clip', [...project.clips, { ...project.clips[0], id: 'duplicate' }]],
	] as const) {
		assert.throws(
			() => createExportPlan({ ...project, clips }, options),
			/exact.*timeline|timeline.*exact|full-source/iu,
			name,
		);
	}
});

function chunkId(chunk: Uint8Array): string {
	return new TextDecoder('ascii').decode(chunk.subarray(0, 4));
}

function payload(chunk: Uint8Array): Uint8Array {
	const byteLength = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(4, true);
	return chunk.subarray(8, 8 + byteLength);
}

function riffChunk(id: string, bytes: Uint8Array, padByte = 0): Uint8Array {
	const chunk = new Uint8Array(8 + bytes.byteLength + (bytes.byteLength & 1));
	chunk.set(new TextEncoder().encode(id));
	new DataView(chunk.buffer).setUint32(4, bytes.byteLength, true);
	chunk.set(bytes, 8);
	if (bytes.byteLength & 1) chunk[chunk.byteLength - 1] = padByte;
	return chunk;
}

function sxmlPayload(samples: number): Uint8Array {
	const xml = new TextEncoder().encode('<frame />');
	const tableSize = 4 + 8 + xml.byteLength;
	const output = new Uint8Array(10 + tableSize + 4);
	const view = new DataView(output.buffer);
	view.setUint16(0, 0, true);
	view.setUint32(2, tableSize, true);
	view.setUint32(10, 1, true);
	view.setUint32(14, xml.byteLength, true);
	view.setUint32(18, samples, true);
	output.set(xml, 22);
	return output;
}

function findAscii(bytes: Uint8Array, value: string): number {
	const pattern = new TextEncoder().encode(value);
	for (let offset = 0; offset <= bytes.byteLength - pattern.byteLength; offset += 1) {
		if (pattern.every((byte, index) => bytes[offset + index] === byte)) return offset;
	}
	return -1;
}
