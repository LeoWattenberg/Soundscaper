/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID,
	DESKTOP_PROJECT_LIBRARY_V10_DATABASE_VERSION,
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../desktop/project-library-v10-contract.ts';
import {
	assertFramescaperDesktopProjectLibraryV10DatabaseIdentity,
	initializeFramescaperDesktopProjectLibraryV10Database,
} from '../desktop/project-library-v10-database.ts';
import {
	createFramescaperDesktopProjectLibraryV10HandshakeGate,
} from '../desktop/project-library-v10-handshake-gate.ts';
import {
	emptyFramescaperDesktopLibraryV10Metadata,
	parseFramescaperDesktopLibraryV10MetadataJson,
	validateFramescaperDesktopLibraryV10Metadata,
} from '../desktop/project-library-v10-metadata.ts';

test('initializes a fresh V10 database with an exact independent identity', () => {
	const database = new DatabaseSync(':memory:');
	try {
		initializeFramescaperDesktopProjectLibraryV10Database(database);
		assert.doesNotThrow(() => assertFramescaperDesktopProjectLibraryV10DatabaseIdentity(database));
		assert.equal(pragma(database, 'application_id'), DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID);
		assert.equal(pragma(database, 'user_version'), DESKTOP_PROJECT_LIBRARY_V10_DATABASE_VERSION);
		assert.deepEqual({ ...database.prepare(
			'SELECT revision, json FROM library_metadata WHERE singleton = 1',
		).get() }, {
			revision: 0,
			json: JSON.stringify(emptyFramescaperDesktopLibraryV10Metadata()),
		});
		const tables = database.prepare(
			"SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
		).all().map((row) => row.name);
		assert.deepEqual(tables, ['library_lease', 'library_metadata', 'metadata_journal']);
	} finally {
		database.close();
	}
});

test('rejects copied V9 and unrelated database identities without mutation', () => {
	for (const [applicationId, version] of [
		[0x53434150, 11],
		[0x11111111, 12],
		[DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID, 11],
	] as const) {
		const database = new DatabaseSync(':memory:');
		try {
			database.exec(`PRAGMA application_id = ${String(applicationId)}; PRAGMA user_version = ${String(version)};`);
			assert.throws(
				() => initializeFramescaperDesktopProjectLibraryV10Database(database),
				/belongs to another application|unsupported.*version/iu,
			);
			assert.equal(pragma(database, 'application_id'), applicationId);
			assert.equal(pragma(database, 'user_version'), version);
			assert.deepEqual(database.prepare(
				"SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
			).all(), []);
		} finally {
			database.close();
		}
	}
});

test('validates exact V10 metadata and only Framescaper V18 project descriptors', () => {
	const digest = 'a'.repeat(64);
	const metadata = validateFramescaperDesktopLibraryV10Metadata({
		schemaVersion: 10,
		revision: 1,
		projects: [{
			id: 'framescaper-v10-entry',
			projectId: 'framescaper-project',
			name: 'Framescaper project',
			metadataFile: `framescaper-v10-entry/4-${digest}.json`,
			preferredProduct: 'framescaper',
			updatedAtMs: 1,
			projectSchemaVersion: 18,
			projectRevision: 4,
			byteLength: 128,
			sha256: digest,
		}],
		media: [{
			id: `p${digest}`,
			relativeFile: `proxy/${digest.slice(0, 2)}/p${digest}.bin`,
			category: 'proxy',
			byteLength: 64,
			sha256: digest,
		}],
	});
	assert.equal(Object.isFrozen(metadata), true);
	assert.equal(Object.isFrozen(metadata.projects), true);
	assert.equal(Object.isFrozen(metadata.media), true);
	assert.deepEqual(parseFramescaperDesktopLibraryV10MetadataJson(JSON.stringify(metadata)), metadata);
	for (const replacement of [
		{ schemaVersion: 9 },
		{ projects: [{ ...metadata.projects[0], preferredProduct: 'soundscaper' }] },
		{ projects: [{ ...metadata.projects[0], projectSchemaVersion: 17 }] },
		{ media: [{ ...metadata.media[0], id: `v${digest}` }] },
		{ media: [{ ...metadata.media[0], category: 'video' }] },
	]) assert.throws(
		() => validateFramescaperDesktopLibraryV10Metadata({ ...metadata, ...replacement }),
		TypeError,
	);
});

test('blocks every operational use until one exact remote handshake succeeds', () => {
	const gate = createFramescaperDesktopProjectLibraryV10HandshakeGate();
	assert.equal(gate.state(), 'pending');
	assert.throws(() => gate.assertOperational(), /handshake.*required/iu);
	assert.throws(() => gate.accept({
		...createFramescaperDesktopProjectLibraryV10Handshake(),
		projectSchemaVersion: 17,
	}), /handshake/iu);
	assert.equal(gate.state(), 'refused');
	assert.throws(() => gate.assertOperational(), /refused/iu);
	assert.throws(
		() => gate.accept(createFramescaperDesktopProjectLibraryV10Handshake()),
		/refused/iu,
	);

	const admitted = createFramescaperDesktopProjectLibraryV10HandshakeGate();
	const remote = createFramescaperDesktopProjectLibraryV10Handshake();
	assert.deepEqual(admitted.accept(remote), remote);
	assert.equal(admitted.state(), 'admitted');
	assert.doesNotThrow(() => admitted.assertOperational());
	assert.throws(() => admitted.accept(remote), /already settled/iu);
});

function pragma(database: DatabaseSync, name: 'application_id' | 'user_version'): number {
	const row = database.prepare(`PRAGMA ${name}`).get();
	return Number(row?.[name]);
}
