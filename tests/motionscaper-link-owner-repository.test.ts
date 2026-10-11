/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { migrateFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';
import { createFramescaperCompositionLink } from '../src/framescaper/editor-project-successor-link.ts';
import { createFramescaperSuccessorHistory, executeFramescaperSuccessorHistory, undoFramescaperSuccessorHistory, type FramescaperSuccessorHistory } from '../src/framescaper/editor-project-successor-history.ts';
import { openFramescaperCompositionLinkOwnerRepository } from '../src/framescaper/editor-composition-link-owner-repository.ts';
import { openFramescaperCompositionLinkRepository } from '../src/framescaper/editor-composition-link-repository.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';
import type { MotionCompositionLinkState } from '../src/common/editor/motion-link-state.ts';

const NOW = '2026-10-11T00:00:00.000Z'; const bytes = new Uint8Array([1, 2, 3, 4]);
const sourceId = 'image-source-1';
function offer(revision: number, changedAsset = false, width = 2) {
	const body = changedAsset ? new Uint8Array([5, 6, 7]) : bytes; const sha256 = digestScapeBytes(body);
	const asset: MotionAsset = { id: 'image', name: 'Image', kind: 'image', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true, sha256, byteLength: body.length, storageKey: `motion-sha256:${sha256}` };
	return createMotionCompositionOffer('main', createMotionscaperRevision({ ...createMotionscaperProject({ id: 'motion', title: `Revision ${revision}`, compositionId: 'main', width, height: 1 }), revision, assets: [asset] }));
}
const readAsset = (asset: MotionAsset) => Promise.resolve({ size: asset.byteLength, stream: () => new Blob([asset.byteLength === 3 ? new Uint8Array([5, 6, 7]) : bytes]).stream() });
function accept(history: FramescaperSuccessorHistory, state: MotionCompositionLinkState) {
	const link = createFramescaperCompositionLink(sourceId, state.accepted.compositionId, state.accepted.revision);
	return executeFramescaperSuccessorHistory(history, { type: 'composition-link/replace', sourceId, expectedDigest: history.present.compositionLinks[0]?.acceptedDigest ?? null, link, commands: [] }, { now: NOW });
}
async function fixture() {
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const repository = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
	const history = createFramescaperSuccessorHistory(migrateFramescaperSuccessorProject(createFramescaperBaselineImageFixture({ imageOnly: true }).project));
	const initial = await repository.saveOwner(history.present, null, history);
	const prepared = await repository.prepareReceive(initial.project.id, sourceId, offer(1), { readAsset }); const next = accept(history, prepared.state);
	const linked = await prepared.commit({ expectedOwnerDigest: initial.ownerDigest, project: next.present, history: next });
	return { repository, factory, indexedDB, linked };
}

test('M10 prepared linked bytes remain private until the exact owner and its one history action commit durably', async () => {
	const { repository, indexedDB, linked } = await fixture();
	try {
		const prepared = await repository.prepareReceive(linked.project.id, sourceId, offer(2, true), { readAsset });
		assert.equal((await repository.loadOwner(linked.project.id))?.project.compositionLinks[0]?.acceptedRevision, 1);
		assert.equal(await repository.readAsset(offer(2, true).revision.project.assets[0]!), null);
		const history = accept(linked.history, prepared.state); const receipt = await prepared.commit({ expectedOwnerDigest: linked.ownerDigest, project: history.present, history });
		assert.equal(receipt.history.undoStack.length, linked.history.undoStack.length + 1); assert.equal(receipt.project.compositionLinks[0]?.acceptedRevision, 2);
		await assert.rejects(prepared.commit({ expectedOwnerDigest: receipt.ownerDigest, project: history.present, history }), /consumed|closed/u);
		await repository.close(); const reopened = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
		try { assert.deepEqual(await reopened.loadOwner(linked.project.id), receipt); assert.ok(await reopened.readAsset(offer(1).revision.project.assets[0]!)); assert.ok(await reopened.readAsset(offer(2, true).revision.project.assets[0]!)); }
		finally { await reopened.close(); }
	} finally { await repository.close(); }
});

test('M10 stale owner CAS and failed owner writes retain the old history and discard unpublished linked bytes', async () => {
	const { repository, factory, linked } = await fixture();
	try {
		const prepared = await repository.prepareReceive(linked.project.id, sourceId, offer(2, true), { readAsset }); const history = accept(linked.history, prepared.state);
		const rename = executeFramescaperSuccessorHistory(linked.history, { type: 'project/rename', title: 'Concurrent edit' }, { now: NOW });
		const newer = await repository.saveOwner(rename.present, linked.ownerDigest, rename);
		await assert.rejects(prepared.commit({ expectedOwnerDigest: linked.ownerDigest, project: history.present, history }), /changed|conflict/u);
		assert.deepEqual(await repository.loadOwner(linked.project.id), newer); assert.equal(await repository.readAsset(offer(2, true).revision.project.assets[0]!), null);
		const retry = await repository.prepareReceive(linked.project.id, sourceId, offer(2, true), { readAsset }); const retriedHistory = accept(newer.history, retry.state);
		factory.failNextPutForStore('owners', new Error('owner disk failure'));
		await assert.rejects(retry.commit({ expectedOwnerDigest: newer.ownerDigest, project: retriedHistory.present, history: retriedHistory }), /owner disk failure/u);
		assert.deepEqual(await repository.loadOwner(linked.project.id), newer); assert.equal(await repository.readAsset(offer(2, true).revision.project.assets[0]!), null);
		assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'staging'), 0); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'chunks'), 1);
	} finally { await repository.close(); }
});

test('M10 owner history Undo pauses updates atomically until an explicit Resume accepts the newest saved revision', async () => {
	const { repository, linked } = await fixture();
	try {
		const update = await repository.prepareReceive(linked.project.id, sourceId, offer(2), { readAsset }); const history = accept(linked.history, update.state);
		const current = await update.commit({ expectedOwnerDigest: linked.ownerDigest, project: history.present, history });
		const undone = undoFramescaperSuccessorHistory(current.history, { now: NOW }); const restore = await repository.prepareTransition(linked.project.id, sourceId, { type: 'restore', offer: offer(1) });
		const paused = await restore.commit({ expectedOwnerDigest: current.ownerDigest, project: undone.present, history: undone }); assert.equal(paused.linkStates[0]?.state.paused, true);
		const latest = await repository.prepareReceive(linked.project.id, sourceId, offer(3), { readAsset }); assert.equal(latest.state.accepted.revision.revision, 1);
		const waiting = await latest.commit({ expectedOwnerDigest: paused.ownerDigest, project: paused.project, history: paused.history }); assert.equal(waiting.linkStates[0]?.state.pending?.revision.revision, 3);
		const resume = await repository.prepareTransition(linked.project.id, sourceId, { type: 'resume' }); const resumedHistory = accept(waiting.history, resume.state);
		const resumed = await resume.commit({ expectedOwnerDigest: waiting.ownerDigest, project: resumedHistory.present, history: resumedHistory }); assert.equal(resumed.project.compositionLinks[0]?.acceptedRevision, 3); assert.equal(resumed.linkStates[0]?.state.paused, false);
	} finally { await repository.close(); }
});

test('M10 accepted link/project mismatch and standalone writes cannot bypass active owner authority', async () => {
	const { repository, indexedDB, linked } = await fixture();
	try {
		const prepared = await repository.prepareReceive(linked.project.id, sourceId, offer(2), { readAsset });
		await assert.rejects(prepared.commit({ expectedOwnerDigest: linked.ownerDigest, project: linked.project, history: linked.history }), /accepted|match/u);
		const standalone = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
		try { await assert.rejects(standalone.receive(linked.project.id, sourceId, offer(2), { readAsset }), /owner|atomic/u); await assert.rejects(standalone.resume(linked.project.id, sourceId), /owner|atomic/u); }
		finally { await standalone.close(); }
		assert.deepEqual(await repository.loadOwner(linked.project.id), linked);
	} finally { await repository.close(); }
});

test('M10 closing owner custody rolls back abandoned preparations and owner digests bind the exact validated history', async () => {
	const { repository, factory, linked } = await fixture();
	await repository.prepareReceive(linked.project.id, sourceId, offer(2, true), { readAsset }); await repository.close();
	assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'staging'), 0); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'chunks'), 1);
	await assert.rejects(repository.loadOwner(linked.project.id), /closed/u);
});

test('M10 closing while a provider stalls cancels its read and reclaims private ownership before returning', async () => {
	const { repository, factory, linked } = await fixture(); let ready!: () => void; let pulls = 0; let cancelled = 0;
	const started = new Promise<void>((resolve) => { ready = resolve; });
	const pending = repository.prepareReceive(linked.project.id, sourceId, offer(2, true), { readAsset: async () => ({ size: 3, stream: () => new ReadableStream<Uint8Array>({
		pull(controller) { if (++pulls === 1) controller.enqueue(new Uint8Array([5, 6])); else ready(); }, cancel() { cancelled++; },
	}, { highWaterMark: 0 }) }) });
	const rejected = pending.then(() => 'published', (error: unknown) => error instanceof Error ? error.name : 'failure');
	await started; await repository.close(); assert.equal(await rejected, 'AbortError'); assert.equal(cancelled, 1);
	assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'staging'), 0); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'chunks'), 1);
});

test('M10 malformed owner history and accessor transitions are refused without invoking code or changing receipt', async () => {
	const { repository, linked } = await fixture(); let calls = 0;
	try {
		const project = { ...linked.project, title: 'Unrecorded mutation' };
		await assert.rejects(repository.saveOwner(project, linked.ownerDigest, linked.history), /history present/u);
		const transition = Object.defineProperty({}, 'type', { enumerable: true, get() { calls++; return 'resume'; } });
		await assert.rejects(repository.prepareTransition(linked.project.id, sourceId, transition as { type: 'resume' }), /accessor|data|field/u);
		assert.equal(calls, 0); assert.deepEqual(await repository.loadOwner(linked.project.id), linked);
	} finally { await repository.close(); }
});

test('M10 forced takeover fences stale autosaves and prepared links even when the exact owner digest is unchanged', async () => {
	const { repository, indexedDB, linked, factory } = await fixture(); const other = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
	try {
		const oldFence = await repository.claimOwnerWriteFence(linked.project.id); const prepared = await repository.prepareReceive(linked.project.id, sourceId, offer(2, true), { readAsset });
		const history = accept(linked.history, prepared.state); const newFence = await other.claimOwnerWriteFence(linked.project.id); assert.notEqual(oldFence, newFence);
		await assert.rejects(prepared.commit({ expectedOwnerDigest: linked.ownerDigest, project: history.present, history, writeFence: oldFence }), /fence|changed/u);
		const rename = executeFramescaperSuccessorHistory(linked.history, { type: 'project/rename', title: 'New writer' }, { now: NOW });
		await assert.rejects(repository.saveOwner(rename.present, linked.ownerDigest, rename, { writeFence: oldFence }), /fence/u);
		await assert.rejects(repository.saveOwner(rename.present, linked.ownerDigest, rename), /fence/u);
		const accepted = await other.saveOwner(rename.present, linked.ownerDigest, rename, { writeFence: newFence }); assert.equal(accepted.project.title, 'New writer');
		assert.equal(await repository.readAsset(offer(2, true).revision.project.assets[0]!), null); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'staging'), 0);
	} finally { await other.close(); await repository.close(); }
});

test('M10 catalog deletion withdraws the owner atomically while preserving original history closure against late writers', async () => {
	const { repository, linked, factory } = await fixture();
	try {
		assert.deepEqual(await repository.listOwners(), [{ project: linked.project, ownerDigest: linked.ownerDigest }]); const fence = await repository.claimOwnerWriteFence(linked.project.id);
		assert.equal(await repository.deleteOwner(linked.project.id, '0'.repeat(64), { writeFence: fence }), false);
		factory.failNextPutForStore('owners', new Error('delete disk failure'));
		await assert.rejects(repository.deleteOwner(linked.project.id, linked.ownerDigest, { writeFence: fence }), /delete disk failure/u);
		assert.deepEqual(await repository.loadOwner(linked.project.id), linked);
		assert.equal(await repository.deleteOwner(linked.project.id, linked.ownerDigest, { writeFence: fence }), true);
		assert.equal(await repository.loadOwner(linked.project.id), null); assert.deepEqual(await repository.listOwners(), []); assert.ok(await repository.readAsset(offer(1).revision.project.assets[0]!));
		await assert.rejects(repository.saveOwner(linked.project, null, linked.history, { writeFence: fence }), /retired|fence/u);
		await assert.rejects(repository.claimOwnerWriteFence(linked.project.id), /retired/u);
	} finally { await repository.close(); }
});

test('M10 a fresh document write fence does not create a catalog entry or permit an unfenced first save', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory; const repository = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
	const project = migrateFramescaperSuccessorProject(createFramescaperBaselineImageFixture({ imageOnly: true }).project);
	try {
		const writeFence = await repository.claimOwnerWriteFence(project.id); assert.deepEqual(await repository.listOwners(), []); assert.equal(await repository.loadOwner(project.id), null);
		await assert.rejects(repository.saveOwner(project, null), /fence/u); const accepted = await repository.saveOwner(project, null, undefined, { writeFence });
		assert.deepEqual(await repository.listOwners(), [{ project: accepted.project, ownerDigest: accepted.ownerDigest }]);
	} finally { await repository.close(); }
});
