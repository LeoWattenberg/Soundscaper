/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { migrateFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';
import { createFramescaperCompositionLink } from '../src/framescaper/editor-project-successor-link.ts';
import { createFramescaperSuccessorHistory, executeFramescaperSuccessorHistory, undoFramescaperSuccessorHistory, type FramescaperSuccessorHistory } from '../src/framescaper/editor-project-successor-history.ts';
import { openFramescaperCompositionLinkOwnerRepository, type FramescaperCompositionLinkOwnerTransition } from '../src/framescaper/editor-composition-link-owner-repository.ts';
import type { MotionCompositionLinkState } from '../src/common/editor/motion-link-state.ts';

const NOW = '2026-10-11T00:00:00.000Z'; const ids = ['image-source-1', 'image-source-2'] as const;
function offer(sourceId: string, revision: number) {
	return createMotionCompositionOffer('main', createMotionscaperRevision({ ...createMotionscaperProject({ id: `motion-${sourceId}`, title: `Revision ${revision}`, compositionId: 'main', width: 2, height: 1 }), revision }));
}
function accept(history: FramescaperSuccessorHistory, sourceId: string, state: MotionCompositionLinkState) {
	return executeFramescaperSuccessorHistory(history, { type: 'composition-link/replace', sourceId, expectedDigest: history.present.compositionLinks.find(link => link.sourceId === sourceId)?.acceptedDigest ?? null,
		link: createFramescaperCompositionLink(sourceId, state.accepted.compositionId, state.accepted.revision), commands: [] }, { now: NOW });
}
async function fixture() {
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	const repository = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
	const image = createFramescaperBaselineImageFixture({ imageOnly: true });
	const project = migrateFramescaperSuccessorProject({ ...image.project, sources: [...image.project.sources, { ...image.source, id: ids[1], storageKey: ids[1] }] });
	const history = createFramescaperSuccessorHistory(project); let receipt = await repository.saveOwner(project, null, history);
	for (const revision of [1, 2]) for (const sourceId of ids) {
		const prepared = await repository.prepareReceive(project.id, sourceId, offer(sourceId, revision), { readAsset: async () => null });
		const next = accept(receipt.history, sourceId, prepared.state); receipt = await prepared.commit({ expectedOwnerDigest: receipt.ownerDigest, project: next.present, history: next });
	}
	const undone = undoFramescaperSuccessorHistory(undoFramescaperSuccessorHistory(receipt.history, { now: NOW }), { now: NOW });
	const actions = ids.map(sourceId => ({ sourceId, transition: { type: 'restore', offer: offer(sourceId, 1) } as const }));
	return { factory, indexedDB, repository, current: receipt, undone, actions };
}

test('M10 one prepared owner batch restores both accepted links and exact Undo history together across reopen', async () => {
	const { repository, indexedDB, current, undone, actions } = await fixture();
	try {
		const prepared = await repository.prepareTransitions(current.project.id, actions);
		assert.deepEqual(prepared.states.map(({ sourceId, state }) => [sourceId, state.accepted.revision.revision, state.pending?.revision.revision, state.paused]), ids.map(id => [id, 1, 2, true]));
		assert.deepEqual(await repository.loadOwner(current.project.id), current);
		const paused = await prepared.commit({ expectedOwnerDigest: current.ownerDigest, project: undone.present, history: undone });
		assert.deepEqual(paused.history, undone); assert.deepEqual(paused.linkStates.map(({ state }) => state.paused), [true, true]);
		await assert.rejects(prepared.commit({ expectedOwnerDigest: paused.ownerDigest, project: paused.project, history: paused.history }), /consumed|closed/u);
		await repository.close(); const reopened = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
		try {
			assert.deepEqual(await reopened.loadOwner(current.project.id), paused);
			const resume = await reopened.prepareTransitions(current.project.id, ids.map(sourceId => ({ sourceId, transition: { type: 'resume' } })));
			const history = resume.states.reduce((value, { sourceId, state }) => accept(value, sourceId, state), paused.history);
			const receipt = await resume.commit({ expectedOwnerDigest: paused.ownerDigest, project: history.present, history });
			assert.deepEqual(receipt.linkStates.map(({ state }) => [state.accepted.revision.revision, state.paused, state.pending]), [[2, false, null], [2, false, null]]);
		} finally { await reopened.close(); }
	} finally { await repository.close(); }
});

test('M10 owner batch rolls every link back on owner write failure or a mismatching candidate', async () => {
	const { repository, factory, current, undone, actions } = await fixture();
	try {
		const prepared = await repository.prepareTransitions(current.project.id, actions);
		factory.failNextPutForStore('owners', new Error('batch disk failure'));
		await assert.rejects(prepared.commit({ expectedOwnerDigest: current.ownerDigest, project: undone.present, history: undone }), /batch disk failure/u);
		assert.deepEqual(await repository.loadOwner(current.project.id), current);
		const mismatch = await repository.prepareTransitions(current.project.id, actions);
		const half = undoFramescaperSuccessorHistory(current.history, { now: NOW });
		await assert.rejects(mismatch.commit({ expectedOwnerDigest: current.ownerDigest, project: half.present, history: half }), /accepted|differs/u);
		assert.deepEqual(await repository.loadOwner(current.project.id), current);
		const abandoned = await repository.prepareTransitions(current.project.id, actions); await abandoned.rollback(); await abandoned.rollback();
		await assert.rejects(abandoned.commit({ expectedOwnerDigest: current.ownerDigest, project: undone.present, history: undone }), /consumed|closed/u);
	} finally { await repository.close(); }
});

test('M10 owner batch checks every captured state and the one current write fence before publication', async () => {
	const { repository, indexedDB, current, undone, actions } = await fixture(); const other = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
	try {
		const fence = await repository.claimOwnerWriteFence(current.project.id); const stale = await repository.prepareTransitions(current.project.id, actions);
		// Pause only the second link at the same accepted revision: owner/history digest stays identical.
		const second = await other.prepareTransition(current.project.id, ids[1], { type: 'restore', offer: offer(ids[1], 2) });
		const changed = await second.commit({ expectedOwnerDigest: current.ownerDigest, project: current.project, history: current.history, writeFence: fence });
		assert.equal(changed.ownerDigest, current.ownerDigest);
		await assert.rejects(stale.commit({ expectedOwnerDigest: current.ownerDigest, project: undone.present, history: undone, writeFence: fence }), /state changed/u);
		assert.deepEqual(await repository.loadOwner(current.project.id), changed);
		const takeover = await repository.prepareTransitions(current.project.id, actions); await other.claimOwnerWriteFence(current.project.id);
		await assert.rejects(takeover.commit({ expectedOwnerDigest: current.ownerDigest, project: undone.present, history: undone, writeFence: fence }), /fence/u);
		assert.deepEqual(await repository.loadOwner(current.project.id), changed);
	} finally { await other.close(); await repository.close(); }
});

test('M10 owner batch admits only bounded distinct plain-data transitions and requires retained history', async () => {
	const { repository, current, actions } = await fixture(); let calls = 0;
	try {
		await assert.rejects(repository.prepareTransitions(current.project.id, []), /requires 1/u);
		await assert.rejects(repository.prepareTransitions(current.project.id, [actions[0]!, actions[0]!]), /duplicate|unique/u);
		await assert.rejects(repository.prepareTransitions(current.project.id, Array.from({ length: 16385 }, () => actions[0]!)), /budget|16384|many|limit/u);
		const bad = Object.defineProperty({ sourceId: ids[0] }, 'transition', { enumerable: true, get() { calls++; return { type: 'resume' }; } });
		await assert.rejects(repository.prepareTransitions(current.project.id, [bad as { sourceId: string; transition: FramescaperCompositionLinkOwnerTransition }]), /accessor|data|field/u); assert.equal(calls, 0);
		await assert.rejects(repository.prepareTransitions(current.project.id, [{ sourceId: ids[0], transition: { type: 'restore', offer: offer(ids[0], 99) } }]), /not retained/u);
		await assert.rejects(repository.prepareTransitions(current.project.id, [{ sourceId: 'missing', transition: { type: 'resume' } }]), /unavailable/u);
		assert.deepEqual(await repository.loadOwner(current.project.id), current);
	} finally { await repository.close(); }
});
