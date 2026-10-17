/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperCompositionLink } from '../src/framescaper/editor-project-successor-link.ts';
import { migrateFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';
import { digestFramescaperMigrationArchive } from '../src/framescaper/editor-project-successor-archive.ts';
import { exportFramescaperLinkedSuccessorArchive } from '../src/framescaper/editor-project-successor-linked-archive.ts';
import { importFramescaperLinkedSuccessorArchive } from '../src/framescaper/editor-project-successor-linked-import.ts';
import { inspectFramescaperMigrationArchive } from '../src/framescaper/editor-project-successor-archive.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { withScapeArchiveReader } from '../src/common/editor/scape-archive-reader.ts';
import { readScapeArchiveEnvelope } from '../src/common/editor/scape-archive-envelope.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';
import { openFramescaperCompositionLinkRepository } from '../src/framescaper/editor-composition-link-repository.ts';
import { openFramescaperSuccessorRepository } from '../src/framescaper/editor-project-successor-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const bytes = new Uint8Array([1, 2, 3, 4]); const sha256 = digestScapeBytes(bytes);
const asset: MotionAsset = { id: 'image', kind: 'image', name: 'Linked.png', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true, byteLength: bytes.length, sha256, storageKey: `motion-sha256:${sha256}` };
async function fixture() {
	const image = createFramescaperBaselineImageFixture({ imageOnly: true });
	const project = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, createFramescaperProject(), { type: 'image-source/set', sourceId: image.source.id, expectedSource: null, source: image.source });
	const json = JSON.stringify(project); const descriptor = { entry: `framescaper/timelineImage/image/${image.source.id}/body`, sourceId: `framescaper:image:${image.source.id}`, kind: 'framescaper-image-asset', encoding: 'framescaper-image-asset-v1', mimeType: image.source.mimeType, size: image.bytes.length, sha256: digestScapeBytes(image.bytes) };
	const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false }); await writer.add('project.json', new TextReader(json));
	await writer.add('manifest.json', new TextReader(JSON.stringify({ format: 'scape-project', formatVersion: 1, project: { entry: 'project.json', schemaFamily: 'framescaper', schemaVersion: 1, size: new TextEncoder().encode(json).length, sha256: digestScapeBytes(new TextEncoder().encode(json)) }, assets: [descriptor] })));
	await writer.add(descriptor.entry, new Blob([new Uint8Array(image.bytes)]).stream()); const originalArchive = await writer.close();
	const motion = createMotionscaperProject({ id: 'motion', title: 'Linked', compositionId: 'main' }); const snapshot = createMotionscaperRevision({ ...motion, assets: [asset, { ...asset, id: 'alias' }] });
	const successor = { ...migrateFramescaperSuccessorProject(project), compositionLinks: [createFramescaperCompositionLink(image.source.id, 'main', snapshot)] };
	return { image, descriptor, record: { id: project.id, archiveDigest: await digestFramescaperMigrationArchive(originalArchive), originalArchive, project: successor } };
}

test('M10 linked successor archives retain unchanged baseline custody and one verified original per linked digest', async () => {
	const { image, descriptor, record } = await fixture(); let reads = 0;
	const archive = await exportFramescaperLinkedSuccessorArchive(record, { readAsset: async () => { reads++; return { size: bytes.length, stream: () => new Blob([bytes]).stream() }; } }); assert.ok(archive);
	assert.equal(reads, 1); await withScapeArchiveReader(archive, undefined, async (entries) => {
		const envelope = await readScapeArchiveEnvelope(entries, {}, undefined, ['framescaper-image-asset', 'motion-linked-original']);
		assert.equal(envelope.manifest.project.schemaVersion, 2); assert.deepEqual(JSON.parse(envelope.projectText) as unknown, record.project); assert.equal(envelope.manifest.assets.length, 2);
		for (const [entry, expected] of [[descriptor.entry, image.bytes], [`motion-links/sha256/${sha256}/original`, bytes]] as const) {
			const chunks: Uint8Array<ArrayBuffer>[] = []; await envelope.entryByName.get(entry)!.getData!(new WritableStream<Uint8Array>({ write(chunk) { chunks.push(new Uint8Array(chunk)); } }));
			assert.deepEqual(new Uint8Array(await new Blob(chunks).arrayBuffer()), expected);
		}
	});
});

test('M10 linked archive missing/corrupt bodies and cancellation publish no Blob and preserve original custody', async () => {
	const { record } = await fixture(); const original = await record.originalArchive.arrayBuffer();
	for (const body of [null, { size: 4, stream: () => new Blob([new Uint8Array([9, 2, 3, 4])]).stream() }, { size: 3, stream: () => new Blob([bytes]).stream() }]) {
		await assert.rejects(exportFramescaperLinkedSuccessorArchive(record, { readAsset: () => Promise.resolve(body) }), /asset|digest|size/u);
	}
	const abort = new AbortController(); abort.abort(); await assert.rejects(exportFramescaperLinkedSuccessorArchive(record, { signal: abort.signal, readAsset: async () => null }), { name: 'AbortError' });
	assert.deepEqual(await record.originalArchive.arrayBuffer(), original);
});

test('M10 linked archive metadata/custody admission refuses before acquiring linked bodies and streamed output honours backpressure', async () => {
	const { record } = await fixture(); let reads = 0; const readAsset = async () => { reads++; return { size: bytes.length, stream: () => new Blob([bytes]).stream() }; };
	await assert.rejects(exportFramescaperLinkedSuccessorArchive(record, { maximumBlobBytes: 1, readAsset }), /Blob|memory/u);
	await assert.rejects(exportFramescaperLinkedSuccessorArchive({ ...record, archiveDigest: '0'.repeat(64) }, { readAsset }), /custody/u);
	await assert.rejects(exportFramescaperLinkedSuccessorArchive({ ...record, project: { ...record.project, title: 'Unassembled edit' } }, { readAsset }), /unchanged baseline/u);
	assert.equal(reads, 0); const chunks: Uint8Array<ArrayBuffer>[] = [];
	const result = await exportFramescaperLinkedSuccessorArchive(record, { readAsset, writable: new WritableStream<Uint8Array>({ async write(chunk) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); chunks.push(new Uint8Array(chunk)); } }) });
	assert.equal(result, null); assert.equal(reads, 1); assert.ok(new Blob(chunks).size > 0);
});

async function portableFixture() {
	const { record } = await fixture(); const archive = await exportFramescaperLinkedSuccessorArchive(record, { readAsset: async () => ({ size: bytes.length, stream: () => new Blob([bytes]).stream() }) });
	assert.ok(archive); return { record, archive };
}
async function replaceEntry(archive: Blob, filename: string, replacement: Uint8Array) {
	return withScapeArchiveReader(archive, undefined, async (entries) => {
		const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
		for (const entry of entries) {
			const chunks: Uint8Array<ArrayBuffer>[] = []; await entry.getData!(new WritableStream<Uint8Array>({ write(chunk) { chunks.push(new Uint8Array(chunk)); } }));
			await writer.add(entry.filename, new Blob(entry.filename === filename ? [new Uint8Array(replacement)] : chunks).stream());
		}
		return writer.close();
	});
}

test('M10 linked import prepares authenticated baseline custody and stages aliases once before its single owner commit', async () => {
	const { record, archive } = await portableFixture(); const events: string[] = []; const received: Uint8Array<ArrayBuffer>[] = [];
	const imported = await importFramescaperLinkedSuccessorArchive(archive, { async begin(project) {
		assert.deepEqual(project, record.project); events.push('begin');
		return { async write(value, chunk) { assert.equal(value.sha256, sha256); events.push('write'); received.push(new Uint8Array(chunk)); },
			async finish(value) { assert.equal(value.sha256, sha256); events.push('finish'); },
			async commit(value) { assert.deepEqual(value.project, record.project); assert.equal((await inspectFramescaperMigrationArchive(value.originalArchive)).archiveDigest, value.archiveDigest); events.push('commit'); },
			async rollback() { events.push('rollback'); } };
	} });
	assert.deepEqual(imported.project, record.project); assert.deepEqual(events, ['begin', 'write', 'finish', 'commit']); assert.deepEqual(new Uint8Array(await new Blob(received).arrayBuffer()), bytes);
});

test('M10 linked import refuses corrupt bodies and rolls back private staging without a visible owner', async () => {
	const { archive } = await portableFixture(); const corrupt = await replaceEntry(archive, `motion-links/sha256/${sha256}/original`, new Uint8Array([9, 2, 3, 4])); const events: string[] = [];
	await assert.rejects(importFramescaperLinkedSuccessorArchive(corrupt, { async begin() { events.push('begin'); return {
		async write() { events.push('write'); }, async finish() { events.push('finish'); }, async commit() { events.push('commit'); }, async rollback() { events.push('rollback'); },
	}; } }), /digest/u);
	assert.deepEqual(events, ['begin', 'write', 'rollback']);
});

test('M10 linked import admits all metadata and baseline memory before staging and cancels before commit', async () => {
	const { archive } = await portableFixture(); let begins = 0;
	const begin = async () => { begins++; return { async write() {}, async finish() {}, async commit() {}, async rollback() {} }; };
	await assert.rejects(importFramescaperLinkedSuccessorArchive(archive, { begin, maximumBaselineBlobBytes: 1 }), /Blob|memory/u); assert.equal(begins, 0);
	const abort = new AbortController(); const events: string[] = [];
	await assert.rejects(importFramescaperLinkedSuccessorArchive(archive, { signal: abort.signal, async begin() { events.push('begin'); return {
		async write() { events.push('write'); abort.abort(); }, async finish() { events.push('finish'); }, async commit() { events.push('commit'); }, async rollback() { events.push('rollback'); },
	}; } }), { name: 'AbortError' }); assert.deepEqual(events, ['begin', 'write', 'rollback']);
});

test('M10 linked archive project, states, revisions and original bytes publish in one durable receiver transaction', async () => {
	const { archive, record } = await portableFixture(); const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const receiver = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
	try {
		await receiver.importArchive(archive); await receiver.close(); const reopened = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
		const owners = await openFramescaperSuccessorRepository({ indexedDB, line: 'successor' });
		try {
			assert.deepEqual((await owners.load(record.id))?.project, record.project); const link = record.project.compositionLinks[0]!;
			assert.equal((await reopened.load(record.id, link.sourceId))?.accepted.revision.digest, link.acceptedDigest);
			assert.equal((await reopened.loadRevision(link.projectId, link.acceptedDigest))?.digest, link.acceptedDigest);
			const body = await reopened.readAsset(asset); assert.ok(body); assert.deepEqual(new Uint8Array(await new Response(body.stream()).arrayBuffer()), bytes);
			await assert.rejects(reopened.importArchive(archive), /already exists/u);
			assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'assets'), 1); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'staging'), 0);
		} finally { owners.close(); await reopened.close(); }
	} finally { await receiver.close(); }
});

test('M10 owner publication failure rolls back every linked archive root and private chunk', async () => {
	const { archive } = await portableFixture(); const factory = createInstrumentedIndexedDB(); const receiver = await openFramescaperCompositionLinkRepository({ indexedDB: factory as unknown as IDBFactory, line: 'successor' });
	try {
		factory.failNextPutForStore('linkStates', new Error('owner disk failure'));
		await assert.rejects(receiver.importArchive(archive), /owner disk failure/u);
		for (const store of ['projects', 'linkStates', 'linkRevisions', 'assets', 'chunks', 'staging']) assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', store), 0, store);
		await receiver.importArchive(archive); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'projects'), 1);
	} finally { await receiver.close(); }
});
