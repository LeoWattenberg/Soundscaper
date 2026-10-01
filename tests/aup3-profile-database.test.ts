/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute as readXmlAttribute,
	audacityXmlAttributes as readXmlAttributes,
	audacityXmlChildren as readXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	commitAup3Autosave,
	initializeAup3Database,
	insertAup3SampleBlock,
	prepareAup3PortableExport,
	writeAup3Document,
} from '../src/common/editor/aup3-database.ts';
import {
	AUP3_APPLICATION_ID,
	AUP3_AUDACITY_VERSION,
	AUP3_BINARY_XML_VERSION,
	AUP3_PAGE_SIZE,
	AUP3_UPSTREAM_COMMIT,
	AUP3_USER_VERSION,
	Aup3Error,
	createAup3ProjectDocument,
	createAup3SampleBlock,
	decodeAup3Float32Samples,
} from '../src/common/editor/aup3-profile.ts';
import { SQL } from './helpers/aup4-database-harness.js';

type XmlNode = ReturnType<typeof createAudacityXmlNode>;

// Admit the legacy JavaScript XML helpers at this strict TypeScript boundary.
const audacityXmlAttribute = readXmlAttribute as unknown as (
	node: unknown, name: string, fallback?: unknown,
) => unknown;
const audacityXmlAttributes = readXmlAttributes as unknown as (
	node: unknown, name?: string,
) => Array<{ name: string; type: string; value: unknown }>;
const audacityXmlChildren = readXmlChildren as unknown as (
	node: unknown, name: string,
) => XmlNode[];

const FORBIDDEN_ROOT_ATTRIBUTES = new Set([
	'viewstate_zoom', 'viewstate_vpos', 'viewstate_hpos',
	'snap_enabled', 'snap_type', 'snap_triplets',
]);
const FORBIDDEN_TRACK_ATTRIBUTES = new Set([
	'isFocused', 'rulerType', 'trackViewType', 'syncWithGlobalSettings',
	'minFreq', 'maxFreq', 'range', 'frequencyGain', 'windowType', 'windowSize',
	'zeroPaddingFactor', 'colorScheme', 'scaleType', 'algorithm',
]);
const FORBIDDEN_CLIP_ATTRIBUTES = new Set([
	'clipStretchToMatchTempo', 'groupId', 'clipTempo', 'isSelected',
]);

test('AUP3 profile rewrites the AUP4 tree to the pinned 3.7.9 XML surface', () => {
	const project = {
		...testProject(),
		snap: { enabled: true, type: 4, triplets: true },
		opaqueExtensions: {
			aup4RootTemplate: {
				node: createAudacityXmlNode('project', [], [
					{ kind: 'blob', name: 'thumbnail', value: Uint8Array.of(1, 2, 3) },
					{ kind: 'node', node: createAudacityXmlNode('vendor-state', [], [
						{ kind: 'blob', name: 'payload', value: Uint8Array.of(4, 5) },
					]) },
				]),
			},
		},
	};
	const result = createAup3ProjectDocument(project, blockMap(17, 3));
	assert.equal(result.omissions.blobCount, 2);
	assert.deepEqual(result.omissions.entries.filter((entry) => entry.kind === 'blob').map((entry) => ({
		name: entry.name,
		byteLength: entry.byteLength,
	})), [
		{ name: 'thumbnail', byteLength: 3 },
		{ name: 'payload', byteLength: 2 },
	]);

	const encoded = encodeAudacityBinaryXml(result.document);
	const decoded = decodeAudacityBinaryXml(encoded.dictionary, encoded.document);
	assert.equal(decoded.documentTokens.some((entry: { kind: string }) => entry.kind === 'blob'), false);
	assert.equal(audacityXmlAttribute(decoded.root, 'version'), AUP3_BINARY_XML_VERSION);
	assert.equal(audacityXmlAttribute(decoded.root, 'audacityversion'), AUP3_AUDACITY_VERSION);
	assert.equal(audacityXmlAttribute(decoded.root, 'snapto'), 'on');
	assert.equal(audacityXmlAttributes(decoded.root).some(({ name }: { name: string }) => FORBIDDEN_ROOT_ATTRIBUTES.has(name)), false);

	const waveTrack = audacityXmlChildren(decoded.root, 'wavetrack')[0];
	assert.ok(waveTrack);
	assert.equal(audacityXmlAttribute(waveTrack, 'channel'), 2);
	assert.equal(audacityXmlAttributes(waveTrack).some(({ name }: { name: string }) => FORBIDDEN_TRACK_ATTRIBUTES.has(name)), false);
	assert.equal(audacityXmlAttributes(waveTrack, 'gain').length, 1);
	assert.equal(audacityXmlAttributes(waveTrack, 'gain')[0]?.type, 'double');
	const waveClip = audacityXmlChildren(waveTrack, 'waveclip')[0];
	assert.ok(waveClip);
	assert.equal(audacityXmlAttributes(waveClip).some(({ name }: { name: string }) => FORBIDDEN_CLIP_ATTRIBUTES.has(name)), false);
	assert.equal(audacityXmlAttribute(waveClip, 'rawAudioTempo'), 0);
	assert.equal(audacityXmlAttributes(waveClip, 'rawAudioTempo')[0]?.type, 'double');
	assert.ok(
		audacityXmlAttributes(waveClip).findIndex(({ name }: { name: string }) => name === 'rawAudioTempo')
		< audacityXmlAttributes(waveClip).findIndex(({ name }: { name: string }) => name === 'clipStretchRatio'),
	);
	const waveBlock = audacityXmlChildren(audacityXmlChildren(waveClip, 'sequence')[0], 'waveblock')[0];
	assert.ok(waveBlock);
	assert.deepEqual(audacityXmlAttributes(waveBlock).map(({ name }: { name: string }) => name), ['start', 'length', 'blockid']);
	assert.ok(result.omissions.entries.some((entry) => entry.kind === 'attribute' && entry.name === 'trackViewType'));
	assert.ok(result.omissions.entries.some((entry) => (
		entry.kind === 'attribute' && entry.name === 'gain'
			&& entry.reason === 'unsupported-aup3-attribute'
	)));
	assert.equal(AUP3_UPSTREAM_COMMIT, '86d74c770974b25188ca2f23bcce47c1181bd08a');

	const stereo = testProject(2);
	const stereoDocument = createAup3ProjectDocument(stereo, new Map([
		['source:0', [{ blockId: 17, sampleCount: 3 }]],
		['source:1', [{ blockId: 18, sampleCount: 3 }]],
	]));
	const stereoEncoded = encodeAudacityBinaryXml(stereoDocument.document);
	const stereoRoot = decodeAudacityBinaryXml(stereoEncoded.dictionary, stereoEncoded.document).root;
	assert.deepEqual(audacityXmlChildren(stereoRoot, 'wavetrack').map((track: unknown) => (
		audacityXmlAttribute(track, 'channel')
	)), [0, 1]);
});

test('AUP3 profile preserves effective clip timing while translating tempo-follow state', () => {
	const base = testProject();
	const directlyRepresentable = {
		...base,
		tempo: 180,
		clips: base.clips.map((clip) => ({
			...clip,
			durationFrames: 1,
			tempo: undefined,
			rawAudioTempo: 120,
			stretchToTempo: true,
		})),
	};
	const directlyRepresentableClip = firstWaveClip(
		createAup3ProjectDocument(directlyRepresentable, blockMap(17, 3)).document,
	);
	assert.equal(audacityXmlAttribute(directlyRepresentableClip, 'rawAudioTempo'), 120);
	assert.equal(audacityXmlAttribute(directlyRepresentableClip, 'clipStretchRatio'), 0.5);
	assert.equal(audacity3EffectiveStretch(directlyRepresentableClip, 180), 1 / 3);

	const tempoSynced = {
		...base,
		tempo: 180,
		clips: base.clips.map((clip) => ({
			...clip,
			tempo: 60,
			rawAudioTempo: 120,
			stretchToTempo: true,
		})),
	};
	const syncedClip = firstWaveClip(createAup3ProjectDocument(tempoSynced, blockMap(17, 3)).document);
	assert.equal(audacityXmlAttribute(syncedClip, 'rawAudioTempo'), 120);
	assert.equal(audacityXmlAttribute(syncedClip, 'clipStretchRatio'), 1.5);
	assert.equal(audacity3EffectiveStretch(syncedClip, 180), 1);

	const fixedTempo = {
		...base,
		tempo: 180,
		clips: base.clips.map((clip) => ({
			...clip,
			tempo: undefined,
			rawAudioTempo: 120,
			stretchToTempo: false,
		})),
	};
	const fixedClip = firstWaveClip(createAup3ProjectDocument(fixedTempo, blockMap(17, 3)).document);
	assert.equal(audacityXmlAttribute(fixedClip, 'rawAudioTempo'), 0);
	assert.equal(audacityXmlAttribute(fixedClip, 'clipStretchRatio'), 1);
	assert.equal(audacity3EffectiveStretch(fixedClip, 180), 1);
	const fixedResult = createAup3ProjectDocument(fixedTempo, blockMap(17, 3));
	assert.ok(fixedResult.omissions.entries.some((entry) => (
		entry.name === 'clipStretchToMatchTempo'
			&& entry.reason === 'unsupported-aup3-tempo-follow'
	)));
});

test('AUP3 database uses only the pinned native tables and round-trips Float32 PCM', () => {
	const database = new SQL.Database();
	try {
		initializeAup3Database(database);
		assert.equal(sqlValue(database, 'PRAGMA application_id'), AUP3_APPLICATION_ID);
		assert.equal(sqlValue(database, 'PRAGMA user_version'), AUP3_USER_VERSION);
		assert.equal(sqlValue(database, 'PRAGMA page_size'), AUP3_PAGE_SIZE);
		assert.deepEqual(database.exec(`
			SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
		`)[0]?.values.flat(), ['autosave', 'project', 'sampleblocks', 'sqlite_sequence']);
		const sampleblocksSql = String(sqlValue(database, `
			SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sampleblocks'
		`));
		assert.match(sampleblocksSql, /blockid\s+INTEGER\s+PRIMARY KEY AUTOINCREMENT/iu);
		assert.equal(database.exec("SELECT name FROM sqlite_master WHERE name = 'project_history'").length, 0);

		const samples = Float32Array.of(-1, -0.25, 0.5);
		const block = createAup3SampleBlock(samples);
		const blockId = insertAup3SampleBlock(database, block);
		const created = createAup3ProjectDocument(testProject(), blockMap(blockId, samples.length));
		writeAup3Document(database, encodeAudacityBinaryXml(created.document));
		assert.equal(commitAup3Autosave(database), true);
		const validation = prepareAup3PortableExport(database);
		assert.equal(validation.source, 'project');
		assert.equal(validation.xmlVersion, AUP3_BINARY_XML_VERSION);
		const summary = validation.summary;
		assert.ok(summary);
		assert.equal(summary.xmlVersion, AUP3_BINARY_XML_VERSION);
		assert.equal(summary.audacityVersion, AUP3_AUDACITY_VERSION);
		assert.deepEqual(validation.references, {
			sequenceCount: 1,
			blockReferenceCount: 1,
			distinctSampleBlockCount: 1,
			sampleBytes: samples.byteLength,
		});
		const stored = database.exec('SELECT samples FROM sampleblocks WHERE blockid = ?', [blockId])[0]?.values[0]?.[0];
		assert.ok(stored instanceof Uint8Array);
		assert.deepEqual(decodeAup3Float32Samples(stored), samples);
		assert.equal(sqlValue(database, 'SELECT count(*) FROM autosave'), 0);
		assert.equal(sqlValue(database, 'SELECT count(*) FROM project WHERE id = 1'), 1);
	} finally {
		database.close();
	}
});

test('AUP3 commits prune sample blocks no longer referenced by the current project', () => {
	const database = new SQL.Database();
	try {
		initializeAup3Database(database);
		const firstBlockId = insertAup3SampleBlock(database, createAup3SampleBlock(Float32Array.of(0.25)));
		const first = createAup3ProjectDocument(testProject(), blockMap(firstBlockId, 1));
		writeAup3Document(database, encodeAudacityBinaryXml(first.document));
		assert.equal(commitAup3Autosave(database), true);

		const secondBlockId = insertAup3SampleBlock(database, createAup3SampleBlock(Float32Array.of(-0.5)));
		const second = createAup3ProjectDocument(testProject(), blockMap(secondBlockId, 1));
		writeAup3Document(database, encodeAudacityBinaryXml(second.document));
		assert.equal(commitAup3Autosave(database), true);

		assert.deepEqual(database.exec('SELECT blockid FROM sampleblocks ORDER BY blockid')[0]?.values.flat(), [secondBlockId]);
		const validation = prepareAup3PortableExport(database);
		assert.equal(validation.references?.distinctSampleBlockCount, 1);
	} finally {
		database.close();
	}
});

test('portable AUP3 validation includes nested cut-line sequences and their audio blocks', () => {
	const database = new SQL.Database();
	try {
		initializeAup3Database(database);
		const mainBlockId = insertAup3SampleBlock(
			database, createAup3SampleBlock(Float32Array.of(-0.5, 0, 0.5)),
		);
		const cutLineBlockId = insertAup3SampleBlock(
			database, createAup3SampleBlock(Float32Array.of(0.75)),
		);
		const created = createAup3ProjectDocument(testProject(), blockMap(mainBlockId, 3));
		const root = created.document.roots.find((entry) => entry.kind === 'node')?.node;
		const waveTrack = root && audacityXmlChildren(root, 'wavetrack')[0];
		const waveClip = waveTrack && audacityXmlChildren(waveTrack, 'waveclip')[0];
		assert.ok(waveClip);
		(waveClip.content as unknown as Array<unknown>).push({
			kind: 'node',
			node: createAudacityXmlNode('waveclip', [], [{
				kind: 'node',
				node: createAudacityXmlNode('sequence', [
					{ kind: 'attribute', name: 'maxsamples', type: 'size-t', value: 262_144 },
					{ kind: 'attribute', name: 'sampleformat', type: 'size-t', value: 0x0004000f },
					{ kind: 'attribute', name: 'numsamples', type: 'long-long', value: 1 },
				], [{
					kind: 'node',
					node: createAudacityXmlNode('waveblock', [
						{ kind: 'attribute', name: 'start', type: 'long-long', value: 0 },
						{ kind: 'attribute', name: 'length', type: 'long-long', value: 1 },
						{ kind: 'attribute', name: 'blockid', type: 'long-long', value: cutLineBlockId },
					]),
				}]),
			}]),
		});
		writeAup3Document(database, encodeAudacityBinaryXml(created.document), { autosave: false });

		const validation = prepareAup3PortableExport(database);
		assert.equal(validation.references?.sequenceCount, 2);
		assert.equal(validation.references?.blockReferenceCount, 2);
		assert.equal(validation.references?.distinctSampleBlockCount, 2);

		database.run('DELETE FROM sampleblocks WHERE blockid = ?', [cutLineBlockId]);
		assert.throws(
			() => prepareAup3PortableExport(database),
			(error: unknown) => error instanceof Aup3Error && error.code === 'MISSING_SAMPLE_BLOCK',
		);
	} finally {
		database.close();
	}
});

test('direct AUP3 project writes prune sample blocks no longer referenced by the current project', () => {
	const database = new SQL.Database();
	try {
		initializeAup3Database(database);
		const firstBlockId = insertAup3SampleBlock(database, createAup3SampleBlock(Float32Array.of(0.25)));
		const first = createAup3ProjectDocument(testProject(), blockMap(firstBlockId, 1));
		writeAup3Document(database, encodeAudacityBinaryXml(first.document), { autosave: false });

		const secondBlockId = insertAup3SampleBlock(database, createAup3SampleBlock(Float32Array.of(-0.5)));
		const second = createAup3ProjectDocument(testProject(), blockMap(secondBlockId, 1));
		writeAup3Document(database, encodeAudacityBinaryXml(second.document), { autosave: false });

		assert.deepEqual(database.exec('SELECT blockid FROM sampleblocks ORDER BY blockid')[0]?.values.flat(), [secondBlockId]);
		assert.equal(prepareAup3PortableExport(database).references?.distinctSampleBlockCount, 1);
	} finally {
		database.close();
	}
});

test('portable AUP3 validation rejects autosaves, profile drift, and missing audio', () => {
	const database = new SQL.Database();
	try {
		initializeAup3Database(database);
		const missing = createAup3ProjectDocument(testProject(), blockMap(999, 3));
		writeAup3Document(database, encodeAudacityBinaryXml(missing.document));
		assert.throws(
			() => prepareAup3PortableExport(database),
			(error: unknown) => error instanceof Aup3Error && error.code === 'UNCOMMITTED_AUTOSAVE',
		);
		assert.equal(commitAup3Autosave(database), true);
		assert.throws(
			() => prepareAup3PortableExport(database),
			(error: unknown) => error instanceof Aup3Error && error.code === 'MISSING_SAMPLE_BLOCK',
		);
		database.run(`PRAGMA user_version = ${String(AUP3_USER_VERSION - 1)}`);
		assert.throws(
			() => prepareAup3PortableExport(database),
			(error: unknown) => error instanceof Aup3Error && error.code === 'UNSUPPORTED_PROFILE',
		);
	} finally {
		database.close();
	}
});

function testProject(channelCount = 1) {
	return {
		id: 'project',
		title: 'AUP3 export',
		sampleRate: 48_000,
		selection: {},
		metadata: {},
		clips: [{
			id: 'clip', sourceId: 'source', title: 'Audio', timelineStartFrame: 0,
			durationFrames: 3, sourceDurationFrames: 3, tempo: 120, groupId: 2,
		}],
		tracks: [{
			id: 'track', type: 'audio', name: 'Audio', clipIds: ['clip'], effects: [],
			display: 'spectrogram', spectrogram: { minimumFrequency: 20, maximumFrequency: 20_000 },
		}],
		sources: [{ id: 'source', frameCount: 3, channelCount, sampleRate: 48_000 }],
		master: { effects: [] },
	};
}

function blockMap(blockId: number, sampleCount: number) {
	return new Map([['source:0', [{ blockId, sampleCount }]]]);
}

function firstWaveClip(document: unknown): XmlNode {
	const encoded = encodeAudacityBinaryXml(document as Parameters<typeof encodeAudacityBinaryXml>[0]);
	const root = decodeAudacityBinaryXml(encoded.dictionary, encoded.document).root;
	const waveTrack = audacityXmlChildren(root, 'wavetrack')[0];
	const waveClip = waveTrack && audacityXmlChildren(waveTrack, 'waveclip')[0];
	assert.ok(waveClip);
	return waveClip;
}

function audacity3EffectiveStretch(waveClip: XmlNode, projectTempo: number): number {
	const stored = Number(audacityXmlAttribute(waveClip, 'clipStretchRatio'));
	const rawTempo = Number(audacityXmlAttribute(waveClip, 'rawAudioTempo'));
	return stored * (rawTempo > 0 ? rawTempo / projectTempo : 1);
}

function sqlValue(database: InstanceType<typeof SQL.Database>, sql: string): unknown {
	return database.exec(sql)[0]?.values[0]?.[0];
}
