/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createMotionscaperProjectStore, MotionProjectConflictError } from '../src/motionscaper/editor-project-store.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { exportMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
const settings = { title: 'Local original', width: 64, height: 32, frameRate: { num: 30, den: 1 }, durationFrames: 6 };
function fixture() {
	const database = createInstrumentedIndexedDB(); const store = createMotionscaperProjectStore({ indexedDB: database as unknown as IDBFactory }); let next = 0;
	return { database, store, session: new MotionscaperDocumentSession(store, () => `review-${++next}`) };
}
const bytes = new Uint8Array([1, 7, 4, 9]), sha256 = digestScapeBytes(bytes);
const asset = { kind: 'image' as const, id: 'retained-unused', name: 'Original image', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true,
	byteLength: bytes.length, sha256, storageKey: `motion-sha256:${sha256}` };
async function archive(id: string) {
	const project = createMotionscaperProject({ ...settings, id, compositionId: 'incoming-composition' });
	const blob = await exportMotionscaperArchive({ ...project, title: 'Incoming original', assets: [asset] }, () => new Blob([bytes]));
	assert.ok(blob); return blob;
}

test('M02 reviewed same-profile Open preserves active history until an explicit choice', async () => {
	const f = fixture();
	try {
		await f.session.create(settings); await f.session.changeSettings({ ...settings, title: 'Unsaved local edit' });
		const before = f.session.getSnapshot(), file = await f.session.saveCopy();
		const review = await f.session.inspectArchive(file.blob);
		assert.equal(review.existing?.active, true); assert.equal(review.existing?.recovery?.title, 'Unsaved local edit');
		assert.equal(review.incoming.title, 'Unsaved local edit'); assert.equal(f.session.getSnapshot().project, before.project);
		const accepted = await f.session.openArchive(review, 'keep'); assert.equal(accepted.bindOriginal, false);
		assert.equal(f.session.getSnapshot().project, before.project); assert.equal(f.session.getSnapshot().canUndo, true);
		await f.session.undo(); assert.equal(f.session.getSnapshot().project?.title, 'Local original');
	} finally { await f.session.dispose(); await f.store.close(); }
});

test('M02 Import copy gets independent identity and retains every original body without changing the source', async () => {
	const f = fixture();
	try {
		await f.session.create(settings); const original = f.session.getSnapshot(), file = await archive(original.project!.id);
		const review = await f.session.inspectArchive(file), accepted = await f.session.openArchive(review, 'copy');
		assert.equal(accepted.bindOriginal, false); assert.notEqual(accepted.projectId, original.project!.id);
		assert.equal((await f.store.load(original.project!.id))?.digest, original.savedDigest);
		assert.equal(f.session.getSnapshot().project?.compositions[0]?.id, 'incoming-composition');
		assert.deepEqual(f.session.getSnapshot().project?.assets, [asset]); assert.deepEqual(new Uint8Array((await f.store.loadAsset(asset)) ? await (await f.store.loadAsset(asset))!.arrayBuffer() : []), bytes);
		const copy = await f.session.saveCopy(); assert.ok(copy.blob.size > 0);
	} finally { await f.session.dispose(); await f.store.close(); }
});

test('M02 Replace retains saved authority, publishes one durable recovery step and can undo to the local draft', async () => {
	const f = fixture();
	try {
		await f.session.create(settings); await f.session.changeSettings({ ...settings, title: 'Local draft' });
		const before = f.session.getSnapshot(), prior = createMotionscaperRevision(before.project!); const publications: string[] = [];
		const unsubscribe = f.store.subscribeSaved(value => publications.push(value.digest));
		const review = await f.session.inspectArchive(await archive(before.project!.id));
		const receipt = await f.session.openArchive(review, 'replace'); assert.equal(receipt.bindOriginal, false);
		assert.equal(f.session.getSnapshot().project?.title, 'Incoming original'); assert.equal(f.session.getSnapshot().project?.revision, prior.revision + 1);
		assert.equal(f.session.getSnapshot().dirty, true); assert.equal(f.session.getSnapshot().savedDigest, before.savedDigest);
		assert.equal((await f.store.load(before.project!.id))?.digest, before.savedDigest); assert.equal((await f.store.loadRecovery(before.project!.id))?.title, 'Incoming original');
		assert.deepEqual(publications, []); assert.equal((await f.store.loadRevision(before.project!.id, prior.digest))?.project.title, 'Local draft');
		await f.session.undo(); assert.equal(f.session.getSnapshot().project?.title, 'Local draft');
		await f.session.redo(); assert.equal(f.session.getSnapshot().project?.title, 'Incoming original');
		await f.session.save(); assert.equal(publications.length, 1); assert.equal(await f.store.loadRecovery(before.project!.id), null); unsubscribe();
	} finally { await f.session.dispose(); await f.store.close(); }
});

test('M02 stale review and failed closure publication leave history, saved head and recovery unchanged', async () => {
	const f = fixture();
	try {
		await f.session.create(settings); const id = f.session.getSnapshot().project!.id, file = await archive(id);
		const stale = await f.session.inspectArchive(file); await f.session.changeSettings({ ...settings, title: 'Newer draft' });
		await assert.rejects(f.session.openArchive(stale, 'replace'), /stale|changed/iu);
		const before = f.session.getSnapshot(), review = await f.session.inspectArchive(file);
		f.database.failNextPutForStore('projects', new Error('Injected owner failure'));
		await assert.rejects(f.session.openArchive(review, 'replace'), /Injected owner failure/u);
		assert.equal(f.session.getSnapshot().project, before.project); assert.equal(f.session.getSnapshot().savedDigest, before.savedDigest);
		assert.equal((await f.store.loadRecovery(id))?.title, 'Newer draft'); assert.equal(await f.store.loadAsset(asset), null);
		assert.equal(f.database.recordCount('kw-media-motionscaper-editor-v1', 'staging'), 0);
		await f.session.openArchive(review, 'replace'); assert.equal(f.session.getSnapshot().project?.title, 'Incoming original');
		await assert.rejects(f.session.openArchive(review, 'replace'), /stale|closed|consumed/iu);
	} finally { await f.session.dispose(); await f.store.close(); }
});

test('M02 inactive saved/recovery choices are explicit and mismatched archives cannot rebind saved authority', async () => {
	const f = fixture();
	try {
		await f.session.create(settings); const id = f.session.getSnapshot().project!.id;
		await f.session.changeSettings({ ...settings, title: 'Recover me' }); const file = await archive(id);
		await f.session.create({ ...settings, title: 'Another document' });
		const review = await f.session.inspectArchive(file); assert.equal(review.existing?.active, false);
		const receipt = await f.session.openArchive(review, 'recover'); assert.equal(receipt.bindOriginal, false);
		assert.equal(f.session.getSnapshot().project?.title, 'Recover me'); assert.equal(f.session.getSnapshot().dirty, true);
		await f.session.create({ ...settings, title: 'Third document' });
		const saved = await f.session.inspectArchive(file); await f.session.openArchive(saved, 'saved');
		assert.equal(f.session.getSnapshot().project?.title, 'Local original'); assert.equal(f.session.getSnapshot().dirty, false);
		await assert.rejects(f.session.importArchive(file), MotionProjectConflictError);
	} finally { await f.session.dispose(); await f.store.close(); }
});

test('M02 replacement publication compares recovery and saved digests inside the owning transaction', async () => {
	const f = fixture();
	try {
		const project = createMotionscaperProject({ ...settings, id: 'fenced-target', compositionId: 'comp' });
		const saved = await f.store.save(project, null), lease = await f.store.acquireWriteAccess(project.id);
		await f.store.saveRecovery({ ...project, revision: 1, title: 'Reviewed draft' }, saved.digest, lease);
		const expected = await f.store.inspectImport(project.id); assert.ok(expected);
		const candidate = { ...project, revision: 4, title: 'Incoming replacement' };
		const staging = await f.store.beginImport(candidate, lease, { recovery: true, expected });
		await f.store.saveRecovery({ ...project, revision: 2, title: 'Intervening draft' }, saved.digest, lease);
		await assert.rejects(async () => staging.commit(candidate), MotionProjectConflictError); await staging.rollback();
		assert.equal((await f.store.loadRecovery(project.id))?.title, 'Intervening draft'); assert.equal((await f.store.load(project.id))?.digest, saved.digest);
		await f.store.releaseWriteAccess(lease);
	} finally { await f.store.close(); }
});
