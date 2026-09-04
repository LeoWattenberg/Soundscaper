import assert from 'node:assert/strict';
import test from 'node:test';
import {
	audacityXmlAttributes,
	audacityXmlChildren,
	createAudacityXmlNode,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	commitAup4Autosave,
	initializeAup4Database,
	insertAup4SampleBlock,
	upgradeAup4Database,
	validateAup4Database,
	writeAup4Document,
} from '../src/common/editor/aup4-database.js';
import {
	AUP4_SCHEMA_SQL,
	AUP4_USER_VERSION,
	createAup4SampleBlock,
} from '../src/common/editor/aup4-profile.js';
import {
	AUP4_NATIVE_LEGACY_USER_VERSION,
	aup4NativeLegacyFixture,
} from './fixtures/aup4-native-legacy.js';
import {
	SQL,
	documentBytes,
	firstSequence,
	firstWaveBlock,
	projectTreeWithBlocks,
	projectWithBlocks,
} from './helpers/aup4-database-harness.js';

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

test('AUP4 validation ignores sample references inside unsupported nested wave clips', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const block = createAup4SampleBlock(Float32Array.of(-1, 0, 1));
		const blockId = insertAup4SampleBlock(database, block);
		const tree = projectTreeWithBlocks([{ blockId, start: 0, sampleCount: 3 }]);
		const outerClip = audacityXmlChildren(audacityXmlChildren(tree, 'wavetrack')[0], 'waveclip')[0];
		outerClip.content.push({
			kind: 'node',
			node: createAudacityXmlNode('waveclip', [], [{
				kind: 'node',
				node: createAudacityXmlNode('sequence', [
					{ kind: 'attribute', name: 'maxsamples', type: 'size-t', value: 262_144 },
					{ kind: 'attribute', name: 'numsamples', type: 'long-long', value: 3 },
				], [{
					kind: 'node',
					node: createAudacityXmlNode('waveblock', [
						{ kind: 'attribute', name: 'start', type: 'long-long', value: 0 },
						{ kind: 'attribute', name: 'length', type: 'long-long', value: 3 },
						{ kind: 'attribute', name: 'blockid', type: 'long-long', value: 999 },
					]),
				}]),
			}]),
		});
		writeAup4Document(database, encodeAudacityBinaryXml(tree));

		const validation = validateAup4Database(database);
		assert.equal(validation.readOnly, false);
		assert.equal(validation.references.sequenceCount, 1);
		assert.equal(validation.references.blockReferenceCount, 1);
		assert.deepEqual(validation.compatibilityReport.missingAudio, []);
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

test('newer Audacity database schemas are rejected before trusting extra tables', () => {
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
		assert.throws(() => validateAup4Database(database), (error) => error.code === 'NEWER_DATABASE');

		database.run('CREATE TRIGGER future_trigger AFTER INSERT ON future_markers BEGIN DELETE FROM project; END');
		assert.throws(() => validateAup4Database(database), (error) => error.code === 'NEWER_DATABASE');
	} finally {
		database.close();
	}
});

test('newer Audacity binary-XML profiles are rejected', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100, '2.1.0'), { autosave: false, now: 0 });
		assert.throws(() => validateAup4Database(database), (error) => error.code === 'NEWER_XML');
	} finally {
		database.close();
	}
});

test('Audacity validation rejects a corrupt selected document unless audit recovery is explicit', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100));
		commitAup4Autosave(database, { now: 1000 });
		writeAup4Document(database, documentBytes(48_000));
		commitAup4Autosave(database, { now: 2000 });
		database.run('UPDATE project SET doc = substr(doc, 1, length(doc) - 1) WHERE id = 1');

		assert.throws(() => validateAup4Database(database), (error) => error.code === 'TRUNCATED_BINARY_XML');
		const recovered = validateAup4Database(database, { allowHistoryRecovery: true });
		assert.equal(recovered.source, 'history');
		assert.equal(recovered.generation, 2);
		assert.equal(recovered.summary.sampleRate, 48_000);
		assert.equal(recovered.recovery.failures[0].code, 'TRUNCATED_BINARY_XML');
		assert.ok(recovered.issues.some((issue) => issue.code === 'RECOVERED_DOCUMENT'));
	} finally {
		database.close();
	}
});

test('Audacity validation rejects a corrupt preferred autosave', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100));
		commitAup4Autosave(database, { now: 1_000 });
		writeAup4Document(database, documentBytes(48_000));
		database.run('UPDATE autosave SET doc = substr(doc, 1, length(doc) - 1) WHERE id = 1');

		assert.throws(() => validateAup4Database(database), (error) => error.code === 'TRUNCATED_BINARY_XML');
		assert.equal(validateAup4Database(database, { useAutosave: false }).summary.sampleRate, 44_100);
	} finally {
		database.close();
	}
});
