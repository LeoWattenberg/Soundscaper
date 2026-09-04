import assert from 'node:assert/strict';
import test from 'node:test';
import {
	audacityXmlAttributes,
	audacityXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	commitAup4Autosave,
	discardExcludedAup4Metadata,
	initializeAup4Database,
	insertAup4SampleBlock,
	listAup4History,
	prepareAup4PortableExport,
	pruneAup4OrphanSampleBlocks,
	readAup4SampleBlock,
	validateAup4Database,
	writeAup4Document,
} from '../src/common/editor/aup4-database.js';
import {
	createAup4SampleBlock,
	readAup4ProjectSummary,
} from '../src/common/editor/aup4-profile.js';
import {
	SQL,
	documentBytes,
	projectTreeWithBlocks,
	projectWithBlocks,
} from './helpers/aup4-database-harness.js';

test('portable AUP4 export requires a committed, checkpointed, fully valid database', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100));
		assert.throws(
			() => prepareAup4PortableExport(database),
			(error) => error.code === 'UNCOMMITTED_AUTOSAVE',
		);
		assert.equal(commitAup4Autosave(database, { now: 0 }), true);
		const validation = prepareAup4PortableExport(database);
		assert.equal(validation.compatible, true);
		assert.equal(validation.readOnly, false);
		assert.equal(validation.source, 'project');
		assert.equal(Number(database.exec('SELECT count(*) FROM autosave')[0].values[0][0]), 0);
		database.run('DELETE FROM project_history');
		assert.throws(
			() => prepareAup4PortableExport(database),
			(error) => error.code === 'UNCOMMITTED_HISTORY',
		);
	} finally {
		database.close();
	}
});

test('portable AUP4 certification never falls back to an older valid history document', () => {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		writeAup4Document(database, documentBytes(44_100));
		commitAup4Autosave(database, { now: 0 });
		writeAup4Document(
			database,
			encodeAudacityBinaryXml(projectTreeWithBlocks([{ blockId: 999, start: 0, sampleCount: 3 }])),
		);
		commitAup4Autosave(database, { now: 1 });

		assert.throws(
			() => prepareAup4PortableExport(database),
			(error) => error.code === 'MISSING_SAMPLE_BLOCK',
		);
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
