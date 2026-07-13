import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import initSqlJs from 'sql.js';

import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/lib/tools/audio-editor/audacity-binary-xml.js';
import {
	commitAup4Autosave,
	deleteAup4SampleBlocks,
	discardExcludedAup4Metadata,
	initializeAup4Database,
	insertAup4SampleBlock,
	listAup4History,
	prepareAup4SerializedDatabase,
	pruneAup4OrphanSampleBlocks,
	readAup4Document,
	readAup4SampleBlock,
	restoreAup4History,
	upgradeAup4Database,
	validateAup4Database,
	writeAup4Document,
} from '../src/lib/tools/audio-editor/aup4-database.js';
import { decodeAup4ProjectTree } from '../src/lib/tools/audio-editor/aup4-conversion.js';
import {
	AUP4_BINARY_XML_VERSION,
	AUP4_SCHEMA_SQL,
	AUP4_USER_VERSION,
	createAup4ProjectTree,
	createAup4SampleBlock,
	decodeAup4Float32Samples,
	readAup4ProjectSummary,
} from '../src/lib/tools/audio-editor/aup4-profile.js';
import {
	AUP4_NATIVE_EMPTY_SHA256,
	aup4NativeEmptyFixture,
} from './fixtures/aup4-native-empty.js';
import {
	AUP4_NATIVE_LEGACY_SHA256,
	AUP4_NATIVE_LEGACY_USER_VERSION,
	aup4NativeLegacyFixture,
} from './fixtures/aup4-native-legacy.js';
import {
	AUP4_NATIVE_RICH_SHA256,
	aup4NativeRichFixture,
} from './fixtures/aup4-native-rich.js';

const SQL = await initSqlJs();

test('native WAL-mode snapshots are normalized only in a private deserialize copy', () => {
	const native = aup4NativeEmptyFixture();
	assert.deepEqual([...native.subarray(18, 20)], [2, 2]);
	const prepared = prepareAup4SerializedDatabase(native);
	assert.deepEqual([...prepared.subarray(18, 20)], [1, 1]);
	assert.deepEqual([...native.subarray(18, 20)], [2, 2]);
	assert.notEqual(prepared.buffer, native.buffer);
	assert.throws(() => prepareAup4SerializedDatabase(Uint8Array.of(1, 2, 3)), (error) => error.code === 'INVALID_DATABASE');
});

test('pinned native legacy AUP4 schema upgrades transactionally to the writer profile', () => {
	const bytes = aup4NativeLegacyFixture();
	assert.equal(createHash('sha256').update(bytes).digest('hex'), AUP4_NATIVE_LEGACY_SHA256);
	const database = new SQL.Database(bytes);
	try {
		assert.equal(database.exec('PRAGMA user_version')[0].values[0][0], AUP4_NATIVE_LEGACY_USER_VERSION);
		assert.equal(database.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='project_history'")[0].values[0][0], 0);
		const migration = upgradeAup4Database(database);
		assert.equal(migration.upgraded, true);
		assert.equal(migration.fromVersion, AUP4_NATIVE_LEGACY_USER_VERSION);
		assert.equal(migration.toVersion, AUP4_USER_VERSION);
		assert.equal(migration.validation.compatible, true);
		assert.equal(migration.validation.readOnly, false);
		assert.equal(database.exec('PRAGMA user_version')[0].values[0][0], AUP4_USER_VERSION);
		assert.equal(database.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='project_history'")[0].values[0][0], 1);
		assert.equal(upgradeAup4Database(database).upgraded, false);
	} finally {
		database.close();
	}
});

test('legacy AUP4 migration refuses unsafe schemas before publishing an upgrade', () => {
	const database = new SQL.Database(aup4NativeLegacyFixture());
	try {
		database.run('CREATE TABLE injected_payload(value TEXT)');
		assert.throws(() => upgradeAup4Database(database), (error) => error.code === 'UNSAFE_SCHEMA');
		assert.equal(database.exec('PRAGMA user_version')[0].values[0][0], AUP4_NATIVE_LEGACY_USER_VERSION);
		assert.equal(database.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='project_history'")[0].values[0][0], 0);
	} finally {
		database.close();
	}
});

test('pinned native Audacity empty project validates and rewrites through the browser codec', async () => {
	const bytes = aup4NativeEmptyFixture();
	assert.equal(createHash('sha256').update(bytes).digest('hex'), AUP4_NATIVE_EMPTY_SHA256);
	const database = new SQL.Database(bytes);
	try {
		const report = validateAup4Database(database);
		assert.equal(report.compatible, true);
		assert.equal(report.readOnly, false);
		assert.equal(report.summary.sampleRate, 44_100);
		assert.equal(report.summary.audioTrackCount, 0);
		assert.equal(report.summary.labelTrackCount, 0);
		assert.equal(report.references.sampleBytes, 0);

		const nativeDocument = readAup4Document(database);
		assert.equal(nativeDocument.source, 'project');
		const nativeAst = decodeAudacityBinaryXml(nativeDocument.dictionary, nativeDocument.document);
		assert.deepEqual(encodeAudacityBinaryXml(nativeAst, { reuseOriginal: true }), {
			dictionary: nativeDocument.dictionary,
			document: nativeDocument.document,
		});

		let id = 0;
		const decoded = await decodeAup4ProjectTree(report.document.root, async () => null, {
			projectId: 'native-empty',
			idFactory: (prefix) => `${prefix}-${++id}`,
		});
		const rewrittenDatabase = new SQL.Database();
		try {
			initializeAup4Database(rewrittenDatabase);
			writeAup4Document(rewrittenDatabase, encodeAudacityBinaryXml(createAup4ProjectTree(decoded.project)), {
				autosave: false,
				now: 0,
			});
			const reopened = new SQL.Database(rewrittenDatabase.export());
			try {
				const rewrittenReport = validateAup4Database(reopened);
				assert.equal(rewrittenReport.compatible, true);
				assert.equal(rewrittenReport.readOnly, false);
				assert.equal(rewrittenReport.summary.sampleRate, 44_100);
				assert.equal(rewrittenReport.summary.audioTrackCount, 0);
			} finally {
				reopened.close();
			}
		} finally {
			rewrittenDatabase.close();
		}
	} finally {
		database.close();
	}
});

test('Audacity-created rich fixture survives browser decode → browser write → browser reopen with exact samples and summaries', async () => {
	const bytes = aup4NativeRichFixture();
	assert.equal(createHash('sha256').update(bytes).digest('hex'), AUP4_NATIVE_RICH_SHA256);
	const nativeDatabase = new SQL.Database(prepareAup4SerializedDatabase(bytes));
	let firstDecoded;
	let nativeBlock;
	try {
		const nativeReport = validateAup4Database(nativeDatabase);
		assert.equal(nativeReport.compatible, true);
		assert.equal(nativeReport.readOnly, false);
		assert.equal(nativeReport.summary.audioTrackCount, 2);
		assert.equal(nativeReport.references.distinctSampleBlockCount, 1);
		nativeBlock = readAup4SampleBlock(nativeDatabase, 1);
		const regenerated = createAup4SampleBlock(decodeAup4Float32Samples(nativeBlock.samples));
		assert.deepEqual(regenerated.samples, nativeBlock.samples);
		assert.deepEqual(regenerated.summary256, nativeBlock.summary256);
		assert.deepEqual(regenerated.summary64k, nativeBlock.summary64k);
		let nextId = 0;
		firstDecoded = await decodeAup4ProjectTree(nativeReport.document.root, async (id) => readAup4SampleBlock(nativeDatabase, id), {
			projectId: 'native-rich',
			title: 'testClipboard.aup4',
			idFactory: (prefix) => `${prefix}-${++nextId}`,
		});
	} finally {
		nativeDatabase.close();
	}
	assert.equal(firstDecoded.project.tracks.filter((track) => track.type === 'audio').length, 2);
	assert.equal(firstDecoded.project.clips.length, 5);
	assert.deepEqual([...new Set(firstDecoded.project.clips.map((clip) => clip.groupId))], [
		'aup4-group-0',
		'aup4-group-1',
		null,
	]);
	assert.ok(firstDecoded.project.clips.every((clip) => clip.stretchToTempo));

	const browserDatabase = new SQL.Database();
	try {
		initializeAup4Database(browserDatabase);
		const channelBlocks = new Map();
		const sampleBlockIds = new Map();
		for (const source of firstDecoded.sources) {
			for (let channel = 0; channel < source.channels.length; channel += 1) {
				const block = createAup4SampleBlock(source.channels[channel]);
				const hash = createHash('sha256').update(block.samples).digest('hex');
				let blockId = sampleBlockIds.get(hash);
				if (blockId == null) {
					blockId = insertAup4SampleBlock(browserDatabase, block);
					sampleBlockIds.set(hash, blockId);
				}
				channelBlocks.set(`${source.sourceId}:${channel}`, [{
					blockId,
					start: 0,
					sampleCount: source.channels[channel].length,
				}]);
			}
		}
		writeAup4Document(browserDatabase, encodeAudacityBinaryXml(createAup4ProjectTree(firstDecoded.project, channelBlocks)), {
			autosave: false,
			now: 0,
		});
		const reopened = new SQL.Database(browserDatabase.export());
		try {
			const browserReport = validateAup4Database(reopened);
			assert.equal(browserReport.compatible, true);
			assert.equal(browserReport.readOnly, false);
			assert.equal(browserReport.summary.audioTrackCount, 2);
			assert.equal(browserReport.references.distinctSampleBlockCount, 1);
			let nextId = 0;
			const secondDecoded = await decodeAup4ProjectTree(browserReport.document.root, async (id) => readAup4SampleBlock(reopened, id), {
				projectId: 'browser-reopened',
				idFactory: (prefix) => `${prefix}-${++nextId}`,
			});
			assert.deepEqual(
				secondDecoded.project.clips.map(portableClipState),
				firstDecoded.project.clips.map(portableClipState),
			);
			assert.deepEqual(
				secondDecoded.sources.flatMap((source) => source.channels.map(channelHash)),
				firstDecoded.sources.flatMap((source) => source.channels.map(channelHash)),
			);
			const rewrittenBlock = readAup4SampleBlock(reopened, 1);
			assert.deepEqual(rewrittenBlock.samples, nativeBlock.samples);
			assert.deepEqual(rewrittenBlock.summary256, nativeBlock.summary256);
			assert.deepEqual(rewrittenBlock.summary64k, nativeBlock.summary64k);
		} finally {
			reopened.close();
		}
	} finally {
		browserDatabase.close();
	}
});

test('browser AUP4 snapshot survives SQLite export and reopen with sample hashes and opaque state intact', async () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const left = createAup4SampleBlock(Float32Array.of(-1, -0.5, 0, 0.25, 0.5, 1));
		const right = createAup4SampleBlock(Float32Array.of(1, 0.5, 0, -0.25, -0.5, -1));
		const leftId = insertAup4SampleBlock(database, left);
		const rightId = insertAup4SampleBlock(database, right);
		const trackEffect = createAudacityXmlNode('effect', [
			{ kind: 'attribute', name: 'id', type: 'string', value: 'audacity-invert' },
			{ kind: 'attribute', name: 'active', type: 'bool', value: true },
		]);
		const masterEffect = createAudacityXmlNode('effect', [
			{ kind: 'attribute', name: 'id', type: 'string', value: 'audacity-limiter' },
		]);
		const opaqueMidi = createAudacityXmlNode('notetrack', [
			{ kind: 'attribute', name: 'format', type: 'long', value: 1 },
		], [{ kind: 'blob', name: 'events', value: Uint8Array.of(0x90, 60, 100, 0x80, 60, 0) }]);
		const project = {
			id: 'browser-project', title: 'Round trip', sampleRate: 48_000,
			tempo: { bpm: 132, timeSignature: { numerator: 7, denominator: 8 } },
			selection: { startFrame: 240, endFrame: 720, trackIds: ['track-1'] },
			metadata: { title: 'Round trip', artist: 'kw.media' },
			sources: [{ id: 'source-1', frameCount: 6, channelCount: 2, sampleRate: 48_000 }],
			clips: [{
				id: 'clip-1', sourceId: 'source-1', title: 'Stretched clip', timelineStartFrame: 480,
				sourceStartFrame: 1, sourceDurationFrames: 4, durationFrames: 8,
				pitchCents: 300, speedRatio: 0.5, groupId: 'group-1',
				envelope: [{ frame: 0, value: 0.75 }, { frame: 4, value: 0.5 }],
			}],
			tracks: [{
				id: 'track-1', type: 'audio', name: 'Stereo', channelCount: 2, sampleRate: 48_000,
				clipIds: ['clip-1'], effects: [{ opaqueAudacityNode: { kind: 'node', node: trackEffect } }],
			}, {
				id: 'labels-1', type: 'label', name: 'Labels', labels: [
					{ id: 'point', title: 'Point', startFrame: 240, endFrame: 240 },
					{ id: 'range', title: 'Range', startFrame: 480, endFrame: 960 },
				],
			}],
			master: { effects: [{ opaqueAudacityNode: { kind: 'node', node: masterEffect } }] },
			opaqueAudacityNodes: [{ kind: 'node', node: opaqueMidi }],
		};
		const encoded = encodeAudacityBinaryXml(createAup4ProjectTree(project, new Map([
			['source-1:0', [{ blockId: leftId, start: 0, sampleCount: 6 }]],
			['source-1:1', [{ blockId: rightId, start: 0, sampleCount: 6 }]],
		])));
		writeAup4Document(database, encoded);
		commitAup4Autosave(database, { now: 1_000 });

		const reopened = new SQL.Database(database.export());
		try {
			const validation = validateAup4Database(reopened);
			assert.deepEqual(validation.references, {
				sequenceCount: 2,
				blockReferenceCount: 2,
				distinctSampleBlockCount: 2,
				sampleBytes: 48,
			});
			for (const [blockId, expected] of [[leftId, left], [rightId, right]]) {
				const actual = readAup4SampleBlock(reopened, blockId);
				for (const field of ['samples', 'summary256', 'summary64k']) {
					assert.equal(sha256(actual[field]), sha256(expected[field]));
				}
			}

			let id = 0;
			const decoded = await decodeAup4ProjectTree(
				validation.document.root,
				async (blockId) => readAup4SampleBlock(reopened, blockId),
				{ projectId: 'reopened', idFactory: (prefix) => `${prefix}-${++id}` },
			);
			assert.deepEqual(decoded.sources[0].channels[0], Float32Array.of(-1, -0.5, 0, 0.25, 0.5, 1));
			assert.deepEqual(decoded.sources[0].channels[1], Float32Array.of(1, 0.5, 0, -0.25, -0.5, -1));
			assert.equal(decoded.project.clips[0].pitchCents, 300);
			assert.equal(decoded.project.clips[0].speedRatio, 0.5);
			assert.equal(decoded.project.clips[0].sourceStartFrame, 1);
			assert.deepEqual(decoded.project.clips[0].envelope, [{ frame: 0, value: 0.75 }, { frame: 4, value: 0.5 }]);
			assert.deepEqual(
				decoded.project.tracks.find((track) => track.type === 'label').labels.map(({ title, startFrame, endFrame }) => ({ title, startFrame, endFrame })),
				[
					{ title: 'Point', startFrame: 240, endFrame: 240 },
					{ title: 'Range', startFrame: 480, endFrame: 960 },
				],
			);

			const rewritten = createAup4ProjectTree(decoded.project);
			const trackEffects = audacityXmlChildren(audacityXmlChildren(rewritten, 'wavetrack')[0], 'effects')[0];
			assert.equal(audacityXmlAttribute(audacityXmlChildren(trackEffects, 'effect')[0], 'id'), 'audacity-invert');
			const masterEffects = audacityXmlChildren(rewritten, 'effects').at(-1);
			assert.equal(audacityXmlAttribute(audacityXmlChildren(masterEffects, 'effect')[0], 'id'), 'audacity-limiter');
			assert.deepEqual(audacityXmlChildren(rewritten, 'notetrack')[0], opaqueMidi);
		} finally {
			reopened.close();
		}
	} finally {
		database.close();
	}
});

test('AUP4 database initializes, autosaves, commits, restores, and validates the pinned schema', () => {
	const database = new SQL.Database();
	try {
		const empty = initializeAup4Database(database);
		assert.equal(empty.source, null);

		const first = documentBytes(44_100);
		writeAup4Document(database, first);
		assert.equal(readAup4Document(database).source, 'autosave');
		assert.equal(commitAup4Autosave(database, { now: new Date('2026-07-13T00:00:00Z') }), true);
		assert.equal(readAup4Document(database).source, 'project');

		const second = documentBytes(48_000);
		writeAup4Document(database, second);
		assert.equal(commitAup4Autosave(database, { now: new Date('2026-07-13T00:01:00Z') }), true);
		assert.deepEqual(listAup4History(database), [
			{ generation: 2, savedAt: 1_783_900_860 },
			{ generation: 1, savedAt: 1_783_900_800 },
		]);
		assert.equal(validateAup4Database(database).summary.sampleRate, 48_000);

		restoreAup4History(database, 1);
		assert.equal(validateAup4Database(database).summary.sampleRate, 44_100);
	} finally {
		database.close();
	}
});

test('AUP4 database stores immutable Float32 blocks', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const id = insertAup4SampleBlock(database, createAup4SampleBlock(Float32Array.of(-1, 0, 1)));
		const block = readAup4SampleBlock(database, id);
		assert.equal(block.blockId, id);
		assert.equal(block.summin, -1);
		assert.equal(block.summax, 1);
		assert.equal(block.samples.byteLength, 12);
		assert.equal(deleteAup4SampleBlocks(database, [id, id]), 1);
		assert.equal(readAup4SampleBlock(database, id), null);
	} finally {
		database.close();
	}
});

test('AUP4 validation rejects arbitrary user-defined schema objects', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		database.run('CREATE TABLE foreign_payload(secret TEXT)');
		assert.throws(() => validateAup4Database(database, { allowEmpty: true }), (error) => error.code === 'UNSAFE_SCHEMA');
	} finally {
		database.close();
	}
});

test('AUP4 validation rejects non-Audacity identifiers and invalid database profiles', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		database.run('PRAGMA application_id = 1234');
		assert.throws(
			() => validateAup4Database(database, { allowEmpty: true }),
			(error) => error.code === 'NOT_AUDACITY_PROJECT',
		);
		database.run('PRAGMA application_id = 1096107097');
		database.run('PRAGMA user_version = 0');
		assert.throws(
			() => validateAup4Database(database, { allowEmpty: true }),
			(error) => error.code === 'INVALID_DATABASE_VERSION',
		);
	} finally {
		database.close();
	}
});

test('AUP4 validation rejects lookalike schemas without native autoincrement keys', () => {
	const database = new SQL.Database();
	try {
		database.exec(AUP4_SCHEMA_SQL.replaceAll('PRIMARY KEY AUTOINCREMENT', 'PRIMARY KEY'));
		assert.throws(
			() => validateAup4Database(database, { allowEmpty: true }),
			(error) => error.code === 'UNSUPPORTED_SCHEMA',
		);
	} finally {
		database.close();
	}
});

test('AUP4 validation checks sample-block references and summary lengths', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const block = createAup4SampleBlock(Float32Array.of(-1, 0, 1));
		const blockId = insertAup4SampleBlock(database, block);
		writeAup4Document(database, projectWithBlocks(blockId, block.sampleCount));
		assert.deepEqual(validateAup4Database(database).references, {
			sequenceCount: 1,
			blockReferenceCount: 1,
			distinctSampleBlockCount: 1,
			sampleBytes: 12,
		});

		database.run('UPDATE sampleblocks SET summary256 = x\'00\' WHERE blockid = ?', [blockId]);
		assert.throws(
			() => validateAup4Database(database),
			(error) => error.code === 'INVALID_SAMPLE_BLOCK',
		);
	} finally {
		database.close();
	}
});

test('AUP4 validation rejects missing blocks and truncated binary XML', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, projectWithBlocks(999, 3));
		assert.throws(() => validateAup4Database(database), (error) => error.code === 'MISSING_SAMPLE_BLOCK');

		const valid = documentBytes(44_100);
		writeAup4Document(database, { ...valid, document: valid.document.subarray(0, valid.document.length - 1) });
		assert.throws(() => validateAup4Database(database), (error) => error.code === 'TRUNCATED_BINARY_XML');
	} finally {
		database.close();
	}
});

test('AUP4 missing local audio is reportable read-only and cloud/account metadata is removed from every retained document', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const tree = projectTreeWithBlocks([{ blockId: 999, start: 0, sampleCount: 3 }]);
		tree.content.unshift({ kind: 'attribute', name: 'cloudAccountId', type: 'string', value: 'secret-user' });
		tree.content.push({ kind: 'node', node: createAudacityXmlNode('audio-com-sync', [
			{ kind: 'attribute', name: 'snapshot', type: 'string', value: 'private-snapshot' },
		]) });
		writeAup4Document(database, encodeAudacityBinaryXml(tree));
		commitAup4Autosave(database, { now: 1_000 });
		writeAup4Document(database, encodeAudacityBinaryXml(tree));

		const report = validateAup4Database(database, { references: { allowMissingSampleBlocks: true } });
		assert.equal(report.readOnly, true);
		assert.deepEqual(report.references.missingSampleBlockIds, [999]);
		assert.deepEqual(report.compatibilityReport.missingAudio, [{
			blockId: 999,
			reason: 'missing-local-sample-block',
			possiblyCloudBacked: true,
			networkAccessAttempted: false,
		}]);
		assert.equal(report.compatibilityReport.networkAccessAttempted, false);
		assert.ok(report.issues.some((issue) => issue.code === 'MISSING_LOCAL_AUDIO'));

		const discarded = discardExcludedAup4Metadata(database);
		assert.equal(discarded.rewrittenDocuments, 3);
		assert.equal(discarded.discardedEntries, 6);
		for (const table of ['project', 'autosave', 'project_history']) {
			const [dictionary, document] = database.exec(`SELECT dict, doc FROM ${table} LIMIT 1`)[0].values[0];
			const root = decodeAudacityBinaryXml(dictionary, document).root;
			assert.equal(audacityXmlAttributes(root, 'cloudAccountId').length, 0);
			assert.equal(audacityXmlChildren(root, 'audio-com-sync').length, 0);
		}
		const exportedText = Buffer.from(database.export()).toString('latin1');
		assert.equal(exportedText.includes('secret-user'), false);
		assert.equal(exportedText.includes('private-snapshot'), false);
		const sanitized = validateAup4Database(database, { references: { allowMissingSampleBlocks: true } });
		assert.equal(sanitized.compatibilityReport.discardedCloudMetadata.discardedEntries, 0);
		assert.equal(sanitized.compatibilityReport.missingAudio[0].possiblyCloudBacked, false);
	} finally {
		database.close();
	}
});

test('AUP4 validation rejects discontinuities, length mismatches, sample-count mismatches, and reference floods', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const block = createAup4SampleBlock(Float32Array.of(-1, 0, 1));
		const blockId = insertAup4SampleBlock(database, block);
		for (const [mutate, code] of [
			[(tree) => { audacityXmlAttributes(firstWaveBlock(tree), 'start')[0].value = 1; }, 'CORRUPT_SEQUENCE'],
			[(tree) => { audacityXmlAttributes(firstWaveBlock(tree), 'length')[0].value = 2; }, 'CORRUPT_SEQUENCE'],
			[(tree) => { audacityXmlAttributes(firstSequence(tree), 'numsamples')[0].value = 2; }, 'CORRUPT_SEQUENCE'],
		]) {
			const tree = projectTreeWithBlocks([{ blockId, start: 0, sampleCount: 3 }]);
			mutate(tree);
			writeAup4Document(database, encodeAudacityBinaryXml(tree));
			assert.throws(() => validateAup4Database(database), (error) => error.code === code);
		}

		const repeated = projectTreeWithBlocks([
			{ blockId, start: 0, sampleCount: 3 },
			{ blockId, start: 3, sampleCount: 3 },
		]);
		writeAup4Document(database, encodeAudacityBinaryXml(repeated));
		assert.throws(
			() => validateAup4Database(database, { references: { maxBlockReferences: 1 } }),
			(error) => error.code === 'REFERENCE_LIMIT',
		);
	} finally {
		database.close();
	}
});

test('newer AUP4 schemas open read-only without trusting their extra tables', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100), { autosave: false, now: 0 });
		database.run(`PRAGMA user_version = ${AUP4_USER_VERSION + 1}`);
		database.run('ALTER TABLE project ADD COLUMN future_flag INTEGER');
		database.run('DROP TABLE autosave');
		database.run('DROP TABLE project_history');
		database.run('CREATE TABLE future_markers(id INTEGER PRIMARY KEY, value TEXT)');
		database.run('CREATE INDEX future_markers_value ON future_markers(value)');
		const validation = validateAup4Database(database);
		assert.equal(validation.readOnly, true);
		assert.equal(validation.references, null);
		assert.ok(validation.issues.some((issue) => issue.code === 'NEWER_DATABASE'));

		database.run('CREATE TRIGGER future_trigger AFTER INSERT ON future_markers BEGIN DELETE FROM project; END');
		assert.throws(() => validateAup4Database(database), (error) => error.code === 'UNSAFE_SCHEMA');
	} finally {
		database.close();
	}
});

test('newer binary-XML profiles open read-only and skip mutable sample registration', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100, '2.1.0'), { autosave: false, now: 0 });
		const validation = validateAup4Database(database);
		assert.equal(validation.compatible, true);
		assert.equal(validation.readOnly, true);
		assert.equal(validation.references, null);
		assert.ok(validation.issues.some((issue) => issue.code === 'NEWER_XML'));
	} finally {
		database.close();
	}
});

test('AUP4 history keeps the newest ten committed documents', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		for (let generation = 1; generation <= 12; generation += 1) {
			writeAup4Document(database, documentBytes(44_100 + generation));
			commitAup4Autosave(database, { now: generation * 1000 });
		}
		const history = listAup4History(database);
		assert.equal(history.length, 10);
		assert.deepEqual(history.map((entry) => entry.generation), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
	} finally {
		database.close();
	}
});

test('AUP4 sampleblock GC retains current and history references and fails closed on corrupt documents', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const first = createAup4SampleBlock(Float32Array.of(0.1, 0.2));
		const firstId = insertAup4SampleBlock(database, first);
		writeAup4Document(database, projectWithBlocks(firstId, first.sampleCount));
		commitAup4Autosave(database, { now: 1_000 });
		const second = createAup4SampleBlock(Float32Array.of(0.3, 0.4));
		const secondId = insertAup4SampleBlock(database, second);
		writeAup4Document(database, projectWithBlocks(secondId, second.sampleCount));
		commitAup4Autosave(database, { now: 2_000 });
		const orphan = insertAup4SampleBlock(database, createAup4SampleBlock(Float32Array.of(0.9)));

		assert.deepEqual(pruneAup4OrphanSampleBlocks(database), { deleted: 1, skipped: false, referenced: 2 });
		assert.equal(readAup4SampleBlock(database, firstId)?.blockId, firstId);
		assert.equal(readAup4SampleBlock(database, secondId)?.blockId, secondId);
		assert.equal(readAup4SampleBlock(database, orphan), null);

		const protectedOrphan = insertAup4SampleBlock(database, createAup4SampleBlock(Float32Array.of(0.8)));
		database.run('UPDATE project_history SET doc = substr(doc, 1, length(doc) - 1) WHERE generation = 1');
		assert.equal(pruneAup4OrphanSampleBlocks(database).skipped, true);
		assert.equal(readAup4SampleBlock(database, protectedOrphan)?.blockId, protectedOrphan);
	} finally {
		database.close();
	}
});

test('AUP4 validation can recover a corrupt current document from native history', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100));
		commitAup4Autosave(database, { now: 1000 });
		writeAup4Document(database, documentBytes(48_000));
		commitAup4Autosave(database, { now: 2000 });
		database.run('UPDATE project SET doc = substr(doc, 1, length(doc) - 1) WHERE id = 1');

		const recovered = validateAup4Database(database);
		assert.equal(recovered.source, 'history');
		assert.equal(recovered.generation, 2);
		assert.equal(recovered.summary.sampleRate, 48_000);
		assert.equal(recovered.recovery.failures[0].code, 'TRUNCATED_BINARY_XML');
		assert.ok(recovered.issues.some((issue) => issue.code === 'RECOVERED_DOCUMENT'));
		assert.throws(
			() => validateAup4Database(database, { allowHistoryRecovery: false }),
			(error) => error.code === 'TRUNCATED_BINARY_XML',
		);
	} finally {
		database.close();
	}
});

test('AUP4 validation prefers a valid project over history when autosave is corrupt', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100));
		commitAup4Autosave(database, { now: 1_000 });
		writeAup4Document(database, documentBytes(48_000));
		database.run('UPDATE autosave SET doc = substr(doc, 1, length(doc) - 1) WHERE id = 1');

		const recovered = validateAup4Database(database);
		assert.equal(recovered.source, 'project');
		assert.equal(recovered.summary.sampleRate, 44_100);
		assert.deepEqual(recovered.recovery.failures.map(({ source, code }) => ({ source, code })), [
			{ source: 'autosave', code: 'TRUNCATED_BINARY_XML' },
		]);
	} finally {
		database.close();
	}
});

test('AUP4 autosave commit rolls back the project and retains autosave when history publication fails', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100));
		commitAup4Autosave(database, { now: 1_000 });
		writeAup4Document(database, documentBytes(48_000));
		database.run(`
			CREATE TRIGGER reject_history BEFORE INSERT ON project_history
			BEGIN SELECT RAISE(ABORT, 'history write failed'); END
		`);
		assert.throws(() => commitAup4Autosave(database, { now: 2_000 }), /history write failed/);
		database.run('DROP TRIGGER reject_history');

		const [[dictionary, document]] = database.exec('SELECT dict, doc FROM project WHERE id = 1')[0].values;
		const current = decodeAudacityBinaryXml(dictionary, document);
		assert.equal(readAup4ProjectSummary(current.root).sampleRate, 44_100);
		assert.equal(Number(database.exec('SELECT count(*) FROM autosave')[0].values[0][0]), 1);
		assert.equal(Number(database.exec('SELECT count(*) FROM project_history')[0].values[0][0]), 1);
	} finally {
		database.close();
	}
});

function documentBytes(rate, version = AUP4_BINARY_XML_VERSION) {
	return encodeAudacityBinaryXml(createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'xmlns', type: 'string', value: 'http://audacity.sourceforge.net/xml/' },
		{ kind: 'attribute', name: 'version', type: 'string', value: version },
		{ kind: 'attribute', name: 'audacityversion', type: 'string', value: '4.0.0' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: rate, digits: -1 },
	]));
}

function projectWithBlocks(blockId, sampleCount) {
	return encodeAudacityBinaryXml(projectTreeWithBlocks([{ blockId, start: 0, sampleCount }]));
}

function projectTreeWithBlocks(blocks) {
	const sampleCount = blocks.reduce((total, block) => total + block.sampleCount, 0);
	return createAup4ProjectTree({
		id: 'project',
		sampleRate: 44_100,
		selection: {},
		metadata: {},
		clips: [{
			id: 'clip', sourceId: 'source', title: 'Audio', timelineStartFrame: 0,
			durationFrames: sampleCount, sourceDurationFrames: sampleCount,
		}],
		tracks: [{
			id: 'track', type: 'audio', name: 'Audio', channelCount: 1,
			sampleRate: 44_100, clipIds: ['clip'], effects: [],
		}],
		sources: [{ id: 'source', frameCount: sampleCount, channelCount: 1 }],
		master: { effects: [] },
	}, new Map([['source:0', blocks]]));
}

function firstSequence(tree) {
	return audacityXmlChildren(audacityXmlChildren(audacityXmlChildren(tree, 'wavetrack')[0], 'waveclip')[0], 'sequence')[0];
}

function firstWaveBlock(tree) {
	return audacityXmlChildren(firstSequence(tree), 'waveblock')[0];
}

function portableClipState(clip) {
	return {
		title: clip.title,
		timelineStartFrame: clip.timelineStartFrame,
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		durationFrames: clip.durationFrames,
		groupId: clip.groupId,
		pitchCents: clip.pitchCents,
		speedRatio: clip.speedRatio,
		stretchToTempo: clip.stretchToTempo,
	};
}

function channelHash(channel) {
	return createHash('sha256')
		.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength))
		.digest('hex');
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
