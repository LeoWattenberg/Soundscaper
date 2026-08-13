/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	FramescaperDesktopProjectLibraryV10Catalog,
} from '../desktop/project-library-v10-catalog.ts';
import {
	DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID,
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../desktop/project-library-v10-contract.ts';
import {
	initializeFramescaperDesktopProjectLibraryV10Database,
} from '../desktop/project-library-v10-database.ts';

const ROOT = resolve(import.meta.dirname, '..');
const MODULE = 'desktop/project-library-v10-catalog.ts';
const TEST_MODULE = 'tests/desktop-project-library-v10-catalog.test.ts';
const MODULE_STEM = 'project-library-v10-catalog';

test('constructs an inert Framescaper-only catalog behind the exact V10 handshake', () => {
	const database = databaseFixture();
	try {
		const catalog = createCatalog(database);
		assert.deepEqual(catalog.owner, owner());
		assert.equal(Object.isFrozen(catalog.owner), true);
		assert.equal(Object.isFrozen(catalog), true);
		assert.equal(catalog.handshakeState(), 'pending');
		assert.deepEqual(catalog.localHandshake,
			createFramescaperDesktopProjectLibraryV10Handshake());
		const metadata = zeroTrapProxy({});
		const lease = zeroTrapProxy({});
		assert.throws(() => catalog.readMetadata(), /handshake.*required/iu);
		assert.throws(() => catalog.publishMetadata({
			expectedRevision: 0,
			lease: lease.proxy as never,
			metadata: metadata.proxy as never,
		}), /handshake.*required/iu);
		assert.deepEqual(metadata.hits, [0, 0, 0, 0]);
		assert.deepEqual(lease.hits, [0, 0, 0, 0]);
	} finally {
		database.close();
	}
});

test('refuses invalid owners, open constructor shapes, and mismatched handshakes before use', () => {
	const database = databaseFixture();
	try {
		for (const value of [
			{ database, owner: { ...owner(), product: 'soundscaper' } },
			{ database, owner: owner(), extra: true },
			null,
		]) assert.throws(
			() => FramescaperDesktopProjectLibraryV10Catalog.create(value),
			TypeError,
		);
		const catalog = createCatalog(database);
		assert.throws(() => catalog.acceptHandshake({
			...createFramescaperDesktopProjectLibraryV10Handshake(),
			desktopDatabaseUserVersion: 11,
		}), /handshake/iu);
		assert.equal(catalog.handshakeState(), 'refused');
		assert.throws(() => catalog.readMetadata(), /refused/iu);
		assert.throws(
			() => catalog.acceptHandshake(createFramescaperDesktopProjectLibraryV10Handshake()),
			/refused/iu,
		);
	} finally {
		database.close();
	}
});

test('reads only integrity-checked V10 metadata from the exact V10 database identity', () => {
	const database = databaseFixture();
	try {
		const catalog = admittedCatalog(database);
		const metadata = catalog.readMetadata();
		assert.deepEqual(metadata, { schemaVersion: 10, revision: 0, projects: [], media: [] });
		assert.equal(Object.isFrozen(metadata), true);
		const row = metadataRow(database);
		assert.equal(row.revision, 0);
		assert.equal(row.digest, digest(String(row.json)));
	} finally {
		database.close();
	}
});

test('rejects V9, unrelated, and wrong-version database identities without mutation', () => {
	for (const [applicationId, userVersion] of [
		[0x53434150, 11],
		[0x11111111, 12],
		[DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID, 11],
	] as const) {
		const database = new DatabaseSync(':memory:');
		try {
			database.exec(`PRAGMA application_id = ${String(applicationId)}; PRAGMA user_version = ${String(userVersion)};`);
			const catalog = admittedCatalog(database);
			const before = database.serialize();
			assert.throws(() => catalog.readMetadata(), /database identity/iu);
			assert.deepEqual(database.serialize(), before);
			assert.deepEqual(database.prepare(
				"SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
			).all(), []);
		} finally {
			database.close();
		}
	}
});

test('acquires, renews, releases, and stale-takes-over one bounded monotonic writer lease', () => {
	const database = databaseFixture();
	let now = 100;
	try {
		const first = admittedCatalog(database, { now: () => now, randomId: ids('a', 'c') });
		const second = admittedCatalog(database, {
			now: () => now,
			owner: { product: 'framescaper', processId: 43, instanceId: 'framescaper-v10-second' },
			randomId: ids('b'),
		});
		assert.throws(() => first.acquireLease({ ttlMs: 999 }), /TTL.*1,000|between/iu);
		const original = first.acquireLease({ ttlMs: 1_000 });
		assert.deepEqual(original, {
			leaseId: 'a'.repeat(48),
			fencingToken: 1,
			owner: owner(),
			acquiredAtMs: 100,
			expiresAtMs: 1_100,
			tookOverStaleLease: false,
		});
		assert.equal(Object.isFrozen(original), true);
		assert.equal(Object.isFrozen(original.owner), true);
		assert.throws(() => second.acquireLease({ ttlMs: 1_000 }), /lease.*busy/iu);

		now = 1_100;
		const replacement = second.acquireLease({ ttlMs: 2_000 });
		assert.equal(replacement.fencingToken, 2);
		assert.equal(replacement.tookOverStaleLease, true);
		const beforeStale = leaseRow(database);
		assert.throws(() => first.renewLease(original, { ttlMs: 1_000 }), /no longer owns/iu);
		assert.equal(first.releaseLease(original), false);
		assert.deepEqual(leaseRow(database), beforeStale);

		now = 1_200;
		const renewed = second.renewLease(replacement, { ttlMs: 2_000 });
		assert.equal(renewed.fencingToken, 2);
		assert.equal(renewed.expiresAtMs, 3_200);
		assert.equal(second.releaseLease(renewed), true);
		const third = first.acquireLease({ ttlMs: 1_000 });
		assert.equal(third.fencingToken, 3);
		assert.equal(third.tookOverStaleLease, false);
	} finally {
		database.close();
	}
});

test('publishes metadata by expected revision through prepared, committed, and complete states', () => {
	const database = databaseFixture();
	let catalog!: FramescaperDesktopProjectLibraryV10Catalog;
	const phases: unknown[] = [];
	try {
		catalog = admittedCatalog(database, {
			checkpoint: (phase) => phases.push({
				phase,
				journal: { ...database.prepare(
					'SELECT state, previous_revision, next_revision FROM metadata_journal',
				).get() },
				metadataRevision: metadataRow(database).revision,
			}),
			now: () => 500,
			randomId: ids('a', 'b'),
		});
		const lease = catalog.acquireLease({ ttlMs: 5_000 });
		const published = catalog.publishMetadata({
			expectedRevision: 0,
			lease,
			metadata: nextMetadata(1),
		});
		assert.deepEqual(published, nextMetadata(1));
		assert.deepEqual(phases, [
			{ phase: 'prepared', journal: { state: 'prepared', previous_revision: 0, next_revision: 1 }, metadataRevision: 0 },
			{ phase: 'committed', journal: { state: 'committed', previous_revision: 0, next_revision: 1 }, metadataRevision: 1 },
			{ phase: 'complete', journal: { state: 'complete', previous_revision: 0, next_revision: 1 }, metadataRevision: 1 },
		]);
		assert.deepEqual(catalog.readMetadata(), nextMetadata(1));
		const row = metadataRow(database);
		assert.equal(row.digest, digest(String(row.json)));
		assert.equal(row.publishedAtMs, 500);
	} finally {
		database.close();
	}
});

test('refuses wrong expected revisions, stale fences, and invalid stored rows without mutation', () => {
	const database = databaseFixture();
	let now = 100;
	try {
		const catalog = admittedCatalog(database, { now: () => now, randomId: ids('a', 'b') });
		const lease = catalog.acquireLease({ ttlMs: 1_000 });
		for (const request of [
			{ expectedRevision: 1, metadata: nextMetadata(1) },
			{ expectedRevision: 0, metadata: nextMetadata(2) },
		]) {
			const before = database.serialize();
			assert.throws(() => catalog.publishMetadata({ ...request, lease }), /revision/iu);
			assert.deepEqual(database.serialize(), before);
		}
		now = 1_100;
		const replacement = catalog.acquireLease({ ttlMs: 1_000 });
		const beforeStale = database.serialize();
		assert.throws(() => catalog.publishMetadata({
			expectedRevision: 0,
			lease,
			metadata: nextMetadata(1),
		}), /no longer owns/iu);
		assert.deepEqual(database.serialize(), beforeStale);
		assert.equal(replacement.fencingToken, 2);

		database.prepare("UPDATE library_metadata SET digest = ? WHERE singleton = 1").run('f'.repeat(64));
		const corruptDigest = database.serialize();
		assert.throws(() => catalog.readMetadata(), /integrity|digest/iu);
		assert.throws(() => catalog.publishMetadata({
			expectedRevision: 0,
			lease: replacement,
			metadata: nextMetadata(1),
		}), /integrity|digest/iu);
		assert.deepEqual(database.serialize(), corruptDigest);
	} finally {
		database.close();
	}
});

test('recovers prepared and committed journals deterministically under the current fence', () => {
	for (const interruptedPhase of ['prepared', 'committed'] as const) {
		const database = databaseFixture();
		let shouldInterrupt = true;
		try {
			const catalog = admittedCatalog(database, {
				checkpoint: (phase) => {
					if (shouldInterrupt && phase === interruptedPhase) throw new Error(`stop after ${phase}`);
				},
				now: () => 500,
				randomId: ids('a', 'b'),
			});
			const lease = catalog.acquireLease({ ttlMs: 5_000 });
			assert.throws(() => catalog.publishMetadata({
				expectedRevision: 0,
				lease,
				metadata: nextMetadata(1),
			}), new RegExp(`stop after ${interruptedPhase}`, 'u'));
			shouldInterrupt = false;
			assert.deepEqual(catalog.recoverMetadata({ lease }), interruptedPhase === 'prepared'
				? { outcome: 'interrupted', previousRevision: 0, publishedRevision: null }
				: { outcome: 'committed', previousRevision: 0, publishedRevision: 1 });
			assert.equal(database.prepare('SELECT state FROM metadata_journal').get()?.state,
				interruptedPhase === 'prepared' ? 'recovered' : 'complete');
			assert.deepEqual(catalog.readMetadata(), interruptedPhase === 'prepared'
				? nextMetadata(0)
				: nextMetadata(1));
			assert.deepEqual(catalog.recoverMetadata({ lease }), {
				outcome: 'clean', previousRevision: null, publishedRevision: null,
			});
		} finally {
			database.close();
		}
	}
});

test('recovery refuses corrupt journals, changed metadata, and stale leases without mutation', () => {
	const database = databaseFixture();
	let now = 100;
	try {
		const catalog = admittedCatalog(database, {
			checkpoint: (phase) => { if (phase === 'prepared') throw new Error('prepared crash'); },
			now: () => now,
			randomId: ids('a', 'b'),
		});
		const stale = catalog.acquireLease({ ttlMs: 1_000 });
		assert.throws(() => catalog.publishMetadata({
			expectedRevision: 0,
			lease: stale,
			metadata: nextMetadata(1),
		}), /prepared crash/u);
		now = 1_100;
		const current = catalog.acquireLease({ ttlMs: 1_000 });
		const beforeStale = database.serialize();
		assert.throws(() => catalog.recoverMetadata({ lease: stale }), /no longer owns/iu);
		assert.deepEqual(database.serialize(), beforeStale);

		database.prepare("UPDATE metadata_journal SET next_digest = ?").run('f'.repeat(64));
		const corrupt = database.serialize();
		assert.throws(() => catalog.recoverMetadata({ lease: current }), /integrity|digest/iu);
		assert.deepEqual(database.serialize(), corrupt);
	} finally {
		database.close();
	}
});

test('stays dormant and isolated from V9, product entrypoints, project bodies, and IPC', async () => {
	const source = await readSource(MODULE);
	assert.deepEqual(importSpecifiers(source), [
		'node:crypto',
		'node:sqlite',
		'./project-library-v10-contract.ts',
		'./project-library-v10-database.ts',
		'./project-library-v10-handshake-gate.ts',
		'./project-library-v10-persistence-codecs.ts',
		'./project-library-v10-metadata.ts',
	]);
	assert.doesNotMatch(source,
		/from ['"]\.\/project-library-(?!v10)|main\.mjs|preload|ipc|electron|project-runtime-profile|editor-project-v18|productId|readFile|writeFile|projectsRoot|managedMediaRoot/iu);
	const references: string[] = [];
	for (const file of await sourceFiles(['desktop', 'src', 'tests'])) {
		if ((await readSource(file)).includes(MODULE_STEM)) references.push(file);
	}
	assert.deepEqual(references, [
		'desktop/project-library-v10-main.ts',
		TEST_MODULE,
	]);
	assert.ok(source.split('\n').length <= 600, 'catalog source must stay under 600 lines');
});

interface CatalogOverrides {
	readonly checkpoint?: (phase: 'prepared' | 'committed' | 'complete') => void;
	readonly now?: () => number;
	readonly owner?: ReturnType<typeof owner>;
	readonly randomId?: () => string;
}

function databaseFixture(): DatabaseSync {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperDesktopProjectLibraryV10Database(database);
	return database;
}

function createCatalog(
	database: DatabaseSync,
	overrides: CatalogOverrides = {},
): FramescaperDesktopProjectLibraryV10Catalog {
	return FramescaperDesktopProjectLibraryV10Catalog.create({
		database,
		owner: overrides.owner ?? owner(),
		...(overrides.checkpoint ? { checkpoint: overrides.checkpoint } : {}),
		...(overrides.now ? { now: overrides.now } : {}),
		...(overrides.randomId ? { randomId: overrides.randomId } : {}),
	});
}

function admittedCatalog(
	database: DatabaseSync,
	overrides: CatalogOverrides = {},
): FramescaperDesktopProjectLibraryV10Catalog {
	const catalog = createCatalog(database, overrides);
	catalog.acceptHandshake(createFramescaperDesktopProjectLibraryV10Handshake());
	return catalog;
}

function owner() {
	return { product: 'framescaper' as const, processId: 42, instanceId: 'framescaper-v10-owner' };
}

function nextMetadata(revision: number) {
	return { schemaVersion: 10 as const, revision, projects: [], media: [] };
}

function ids(...characters: string[]): () => string {
	let index = 0;
	return () => (characters[index++] ?? 'f').repeat(48);
}

function digest(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function metadataRow(database: DatabaseSync): Record<string, unknown> {
	return { ...database.prepare(`
		SELECT revision, json, digest, published_at_ms AS publishedAtMs
		FROM library_metadata WHERE singleton = 1
	`).get() };
}

function leaseRow(database: DatabaseSync): Record<string, unknown> {
	return { ...database.prepare('SELECT * FROM library_lease WHERE singleton = 1').get() };
}

function zeroTrapProxy(target: object) {
	const hits = [0, 0, 0, 0];
	return { proxy: new Proxy(target, {
		getPrototypeOf() { hits[0] += 1; throw new Error('prototype trap'); },
		ownKeys() { hits[1] += 1; throw new Error('keys trap'); },
		getOwnPropertyDescriptor() { hits[2] += 1; throw new Error('descriptor trap'); },
		get() { hits[3] += 1; throw new Error('get trap'); },
	}), hits };
}

async function sourceFiles(roots: readonly string[]): Promise<string[]> {
	const output: string[] = [];
	for (const root of roots) await visit(root);
	return output.sort();
	async function visit(relativePath: string): Promise<void> {
		for (const entry of await readdir(resolve(ROOT, relativePath), { withFileTypes: true })) {
			const child = `${relativePath}/${entry.name}`;
			if (entry.isDirectory()) await visit(child);
			else if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) output.push(child.split(sep).join('/'));
		}
	}
}

async function readSource(relativePath: string): Promise<string> {
	return readFile(resolve(ROOT, relativePath), 'utf8');
}

function importSpecifiers(source: string): string[] {
	return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]);
}
