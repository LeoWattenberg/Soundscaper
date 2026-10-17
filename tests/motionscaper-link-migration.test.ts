/* SPDX-License-Identifier: AGPL-3.0-only */
import { smallMotionscaperArchiveBytes } from './helpers/motionscaper-small-archive-bytes.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { withScapeArchiveReader } from '../src/common/editor/scape-archive-reader.ts';
import { readScapeArchiveEnvelope, type ScapeAssetDescriptor } from '../src/common/editor/scape-archive-envelope.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperCompositionLink, normalizeFramescaperCompositionLink } from '../src/framescaper/editor-project-successor-link.ts';
import { openFramescaperSuccessorRepository } from '../src/framescaper/editor-project-successor-repository.ts';
import { inspectFramescaperMigrationArchive, exportFramescaperSuccessorArchive } from '../src/framescaper/editor-project-successor-archive.ts';
import { openFramescaperCompositionLinkOwnerRepository } from '../src/framescaper/editor-composition-link-owner-repository.ts';
import { openFramescaperSuccessorDatabase } from '../src/framescaper/editor-project-successor-database.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { migrateFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';

async function archive(value: unknown, assets: readonly { descriptor: ScapeAssetDescriptor; body: Uint8Array }[] = []): Promise<Blob> {
	const json = JSON.stringify(value);
	const bytes = new TextEncoder().encode(json);
	const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
	await writer.add('project.json', new TextReader(json));
	await writer.add('manifest.json', new TextReader(JSON.stringify({ format: 'scape-project', formatVersion: 1,
		project: { entry: 'project.json', schemaFamily: 'framescaper', schemaVersion: 1, size: bytes.length, sha256: bytesToHex(sha256(bytes)) }, assets: assets.map(({ descriptor }) => descriptor) })));
	for (const asset of assets) await writer.add(asset.descriptor.entry, new Blob([new Uint8Array(asset.body)]).stream());
	return writer.close();
}

test('successor migration stages a complete original archive then recovers idempotently across reopen', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const project = createFramescaperProject();
	const original = await archive(project);
	const repository = await openFramescaperSuccessorRepository({ indexedDB, line: 'successor' });
	const pending = await repository.stage(original);
	assert.equal(await repository.load(project.id), null);
	repository.close();
	const reopened = await openFramescaperSuccessorRepository({ indexedDB, line: 'successor' });
	assert.deepEqual(await reopened.recover(), [project.id]);
	assert.deepEqual(await reopened.recover(), []);
	const migrated = await reopened.load(project.id);
	assert.ok(migrated);
	assert.equal(migrated.project.schemaVersion, 2);
	assert.equal(migrated.project.id, project.id);
	assert.equal(migrated.archiveDigest, pending.archiveDigest);
	assert.deepEqual(migrated.project.compositionLinks, []);
	assert.deepEqual(await smallMotionscaperArchiveBytes(migrated.originalArchive), new Uint8Array(await original.arrayBuffer()));
	assert.equal((await reopened.stage(original)).archiveDigest, pending.archiveDigest);
	assert.equal((await reopened.complete(project.id)).archiveDigest, pending.archiveDigest);
	const output = await exportFramescaperSuccessorArchive(migrated);
	assert.equal((await inspectFramescaperMigrationArchive(original)).project.schemaVersion, 1);
	assert.ok(output.size > 0);
	await assert.rejects(reopened.stage(await archive({ ...project, title: 'Conflicting edit' })), /conflict/iu);
	await assert.rejects(openFramescaperSuccessorRepository({ indexedDB, line: 'baseline' }), /successor/iu);
	reopened.close();
});

test('migration rejects damaged or mismatched archives before any publication', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const repository = await openFramescaperSuccessorRepository({ indexedDB, line: 'successor' });
	await assert.rejects(repository.stage(new Blob(['not a ZIP'])), /archive|zip|signature/iu);
	await assert.rejects(repository.stage(await archive({ ...createFramescaperProject(), schemaVersion: 2 })), /identity|schema/iu);
	assert.deepEqual(await repository.list(), []);
	repository.close();
});

test('typed composition link binds output, immutable revision and complete asset closure without local capabilities', () => {
	const revision = createMotionscaperRevision(createMotionscaperProject({ id: 'motion-project', title: 'Composition', compositionId: 'composition' }));
	const compositionId = revision.project.compositions[0]!.id;
	const link = createFramescaperCompositionLink('linked-source', compositionId, revision);
	assert.equal(link.acceptedDigest, revision.digest);
	assert.equal(link.projectId, revision.projectId);
	assert.equal(link.snapshot.digest, revision.digest);
	assert.deepEqual(link.dependencyDigests, revision.assetDigests);
	assert.throws(() => normalizeFramescaperCompositionLink({ ...link, sourcePath: '/private/project.mscape' }), /unsupported|field/iu);
	assert.throws(() => normalizeFramescaperCompositionLink({ ...link, acceptedRevision: link.acceptedRevision + 1 }), /revision|identity/iu);
	assert.throws(() => normalizeFramescaperCompositionLink({ ...link, output: { ...link.output, width: link.output.width + 1 } }), /output/iu);
	assert.throws(() => normalizeFramescaperCompositionLink({ ...link, dependencyDigests: ['a'.repeat(64)] }), /closure/iu);
});

test('successor publication abort rolls back atomically and retains the prepared original for recovery', async () => {
	const factory = createInstrumentedIndexedDB();
	const repository = await openFramescaperSuccessorRepository({ indexedDB: factory as unknown as IDBFactory, line: 'successor' });
	const project = createFramescaperProject();
	await repository.stage(await archive(project));
	factory.failNextDeleteForStore('pending', new Error('disk failure'));
	await assert.rejects(repository.complete(project.id), /disk failure/u);
	assert.equal(await repository.load(project.id), null);
	assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'pending'), 1);
	assert.deepEqual(await repository.recover(), [project.id]);
	assert.equal(factory.recordCount('kw-media-framescaper-editor-v1', 'projects'), 0);
	repository.close();
});

test('successor migration verifies and exports complete image bytes with unchanged source identities', async () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, createFramescaperProject(),
		{ type: 'image-source/set', sourceId: fixture.source.id, expectedSource: null, source: fixture.source });
	const descriptor = { entry: `framescaper/timelineImage/image/${fixture.source.id}/body`, sourceId: `framescaper:image:${fixture.source.id}`,
		kind: 'framescaper-image-asset', encoding: 'framescaper-image-asset-v1', mimeType: fixture.source.mimeType,
		size: fixture.bytes.byteLength, sha256: bytesToHex(sha256(fixture.bytes)) };
	const original = await archive(project, [{ descriptor, body: fixture.bytes }]);
	const repository = await openFramescaperSuccessorRepository({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, line: 'successor' });
	await repository.stage(original);
	const migrated = await repository.complete(project.id);
	const exported = await exportFramescaperSuccessorArchive(migrated);
	await withScapeArchiveReader(exported, undefined, async (entries) => {
		const envelope = await readScapeArchiveEnvelope(entries, {}, undefined, ['framescaper-image-asset']);
		assert.equal(envelope.manifest.project.schemaVersion, 2);
		const body: Uint8Array[] = [];
		await envelope.entryByName.get(descriptor.entry)!.getData!(new WritableStream<Uint8Array>({ write(chunk) { body.push(chunk); } }));
		assert.deepEqual(new Uint8Array(await new Blob(body.map((chunk) => new Uint8Array(chunk))).arrayBuffer()), fixture.bytes);
	});
	const damaged = fixture.bytes.slice(); damaged[damaged.length - 1] ^= 1;
	await assert.rejects(repository.stage(await archive(project, [{ descriptor, body: damaged }])), /digest/iu);
	repository.close();
});

test('successor migration and fresh owner creation cannot claim each other’s pending or active identity', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory; const project = createFramescaperProject();
	const migration = await openFramescaperSuccessorRepository({ indexedDB, line: 'successor' }); const owner = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
	try {
		await migration.stage(await archive(project));
		await assert.rejects(owner.saveOwner(migrateFramescaperSuccessorProject(project), null), /pending/u);
		await assert.rejects(owner.claimOwnerWriteFence(project.id), /pending/u);
		await migration.complete(project.id); const retained = await owner.loadOwner(project.id); assert.ok(retained);
		assert.equal(retained.project.id, project.id); await assert.rejects(owner.saveOwner(retained.project, null), /changed/u);
		const fresh = createFramescaperProject(); const receipt = await owner.saveOwner(migrateFramescaperSuccessorProject(fresh), null);
		await assert.rejects(migration.stage(await archive(fresh)), /another active owner/u); assert.deepEqual(await owner.loadOwner(fresh.id), receipt);
		assert.equal(await migration.load(fresh.id), null);
	} finally { migration.close(); await owner.close(); }
});

test('M10 interrupted legacy Blob custody upgrades on completion and retains exact bytes after the connection closes', async () => {
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const project = createFramescaperProject(); const originalArchive = await archive(project);
	const inspected = await inspectFramescaperMigrationArchive(originalArchive);
	const database = await openFramescaperSuccessorDatabase(indexedDB, 'successor');
	await transact(database, ['pending'], 'readwrite', stores => request(stores.pending.add({ id: project.id, archiveDigest: inspected.archiveDigest, originalArchive, project: migrateFramescaperSuccessorProject(project) })));
	database.close(); const repository = await openFramescaperSuccessorRepository({ indexedDB, line: 'successor' });
	try {
		factory.failNextDeleteForStore('pending', new Error('legacy publication failure'));
		await assert.rejects(repository.complete(project.id), /legacy publication failure/u);
		assert.equal(factory.recordCount(database.name, 'archiveBodies'), 0); assert.equal(factory.recordCount(database.name, 'archiveChunks'), 0);
		assert.deepEqual(await repository.recover(), [project.id]); const record = await repository.load(project.id); assert.ok(record);
		assert.ok(!(record.originalArchive instanceof Blob)); repository.close();
		assert.deepEqual(await smallMotionscaperArchiveBytes(record.originalArchive), new Uint8Array(await originalArchive.arrayBuffer()));
		assert.equal(factory.recordCount(database.name, 'archiveBodies'), 1); assert.equal(factory.recordCount(database.name, 'archiveStages'), 0);
	} finally { repository.close(); }
});
