/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopWorkflowV1, type ExecutePhotoDevelopV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v1.ts';
import type { PhotoLibraryDevelopAcknowledgementV1, PhotoLibraryDevelopApplyV1, PhotoLibraryDevelopPortV1,
	PhotoLibraryDevelopSnapshotV1 } from '../src/common/editor/photo-library-develop-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { VideoEffectLeaf } from '../src/common/editor/project-media-types.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

function snapshot(revision = 7, versionId = 'master'): PhotoLibraryDevelopSnapshotV1 {
	return { schemaVersion: 1, photoId: 'photo', revision, versionId, activeVersionId: 'master',
		versions: [{ id: 'master', name: 'Original', kind: 'master' }, { id: 'copy', name: 'Copy', kind: 'virtual-copy' }],
		develop: { processVersion: 1, effects: [], masks: [], maskBindings: [], geometry: {
			crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false } },
		history: { cursor: 0, entries: [{ index: 0, label: 'Initial', createdAt: null }] }, snapshots: [] };
}
function host() {
	const requests: PhotoLibraryDevelopApplyV1[] = [], reads: (string | undefined)[] = [];
	let current = true, refreshes = 0, acquired = 0;
	const port: PhotoLibraryDevelopPortV1 = {
		read: async request => { reads.push(request.versionId); return snapshot(7, request.versionId); },
		apply: async request => { requests.push(request); return { snapshot: snapshot(8, 'versionId' in request.command ? request.command.versionId : 'master'), notices: [] }; },
	};
	const execute: ExecutePhotoDevelopV1 = async (action, signal) => {
		await action({ signal: signal ?? new AbortController().signal, acquire: async () => { acquired++; return port; },
			isCurrent: () => current, refresh: async () => { refreshes++; } }); return 'completed';
	};
	const owner = new PhotoLibraryDevelopWorkflowV1({ execute, now: () => '2026-10-09T00:00:00.000Z' });
	return { owner, port, requests, reads, get acquired() { return acquired; }, get refreshes() { return refreshes; }, retire() { current = false; } };
}

test('menu-owned workflow borrows one explicit photo/version and saves one immutable draft/history command', async () => {
	const h = host(); assert.equal(h.acquired, 0); assert.equal(h.owner.snapshot().visible, false);
	await h.owner.open('photo', 'copy'); const before = h.owner.snapshot().document!;
	h.owner.setEffects([createVideoEffect('white-balance-v1', { id: 'wb', params: { temperature: 0.25 } }) as VideoEffectLeaf]);
	assert.equal(before.develop.effects.length, 0); assert.equal(h.requests.length, 0);
	const receipt = await h.owner.save('White balance');
	assert.equal(receipt?.snapshot.revision, 8); assert.equal(h.requests[0]?.expectedRevision, 7);
	assert.equal(h.requests[0]?.command.type, 'record-develop');
	assert.equal('versionId' in h.requests[0]!.command && h.requests[0]!.command.versionId, 'copy');
	assert.equal(h.refreshes, 1); assert.equal(h.owner.snapshot().dirty, false); await h.owner.close();
});

test('numeric gestures preview locally, Escape restores exact draft and no native write occurs', async () => {
	const h = host(); await h.owner.open('photo');
	h.owner.setEffects([createVideoEffect('tone-ladder-v1', { id: 'tone' }) as VideoEffectLeaf]); const draft = h.owner.snapshot().draft;
	h.owner.beginGesture(); h.owner.previewEffect('tone', { exposure: 2 });
	assert.equal(h.owner.snapshot().draft!.effects[0]?.params.exposure, 2);
	h.owner.cancelGesture(); assert.equal(h.owner.snapshot().draft, draft);
	h.owner.beginGesture(); h.owner.previewEffect('tone', { exposure: 1 }); h.owner.commitGesture();
	assert.equal(h.owner.snapshot().draft!.effects[0]?.params.exposure, 1); assert.equal(h.requests.length, 0); await h.owner.close();
});

test('held acquisition is synchronously exclusive and cancellation joins before body admission', async () => {
	const held = deferred<PhotoLibraryDevelopPortV1>(), h = host(); let settled = false, reads = 0;
	const owner = new PhotoLibraryDevelopWorkflowV1({ execute: async (run, signal) => {
		await run({ signal: signal!, acquire: () => held.promise, isCurrent: () => true, refresh: async () => undefined }); return 'completed';
	} });
	h.port.read = async () => { reads++; return snapshot(); };
	const opening = owner.open('photo'); void opening.then(() => { settled = true; });
	await owner.open('other'); assert.equal(owner.snapshot().busy, true);
	let joined = false; const cancelled = owner.cancel().then(() => { joined = true; }); await settle();
	assert.equal(joined, false); assert.equal(settled, false);
	held.resolve(h.port); await Promise.all([opening, cancelled]); assert.equal(reads, 0); assert.equal(joined, true); await owner.close();
});

test('held read is joined on Close and never publishes a late document', async () => {
	const h = host(), held = deferred<PhotoLibraryDevelopSnapshotV1>(); h.port.read = () => held.promise;
	const opening = h.owner.open('photo'); await settle(); let joined = false;
	const closing = h.owner.close().then(() => { joined = true; }); await settle(); assert.equal(joined, false);
	held.resolve(snapshot()); await Promise.all([opening, closing]);
	assert.equal(h.owner.snapshot().visible, false); assert.equal(h.owner.snapshot().document, null);
});

test('command and complete recipe detach before held acquire without getters or mutable authority', async () => {
	const h = host(); await h.owner.open('photo'); const held = deferred<PhotoLibraryDevelopPortV1>();
	let hold = true;
	const execute: ExecutePhotoDevelopV1 = async (run, signal) => {
		await run({ signal: signal!, acquire: () => hold ? held.promise : Promise.resolve(h.port), isCurrent: () => true, refresh: async () => undefined }); return 'completed';
	};
	const owner = new PhotoLibraryDevelopWorkflowV1({ execute }); hold = false; await owner.open('photo'); hold = true;
	const effect = createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } }) as VideoEffectLeaf & { params: Record<string, number> };
	const develop = { ...snapshot().develop, effects: [effect] };
	const command = { type: 'record-develop' as const, versionId: 'master', develop, label: 'Tone', createdAt: '2026-10-09T00:00:00.000Z' };
	const applying = owner.apply(command); command.label = 'Mutated'; develop.effects[0]!.params.exposure = 3;
	held.resolve(h.port); await applying;
	assert.equal(h.requests.at(-1)?.command.type, 'record-develop');
	const captured = h.requests.at(-1)!.command; assert.equal(captured.type === 'record-develop' && captured.label, 'Tone');
	assert.equal(captured.type === 'record-develop' && captured.develop.effects[0]?.params.exposure, 1);
	let traps = 0; await owner.apply({ get type() { traps++; return 'activate-version'; }, versionId: 'master' } as never);
	assert.equal(traps, 0); await Promise.all([owner.close(), h.owner.close()]);
});

test('known durable ACK survives late Cancel and failed refresh, retaining cleanup notice', async () => {
	const h = host(), held = deferred<PhotoLibraryDevelopAcknowledgementV1>(); await h.owner.open('photo');
	h.port.apply = () => held.promise;
	const applying = h.owner.apply({ type: 'save-develop-snapshot', versionId: 'master', id: 'snapshot', name: 'Look', createdAt: '2026-10-09T00:00:00.000Z' });
	await settle(); const cancelling = h.owner.cancel();
	held.resolve({ snapshot: snapshot(8), notices: ['cleanup-failed'] }); const receipt = await applying; await cancelling;
	assert.equal(receipt?.snapshot.revision, 8); assert.deepEqual(h.owner.snapshot().receipt?.notices, ['cleanup-failed']);
	assert.equal(h.owner.snapshot().notice, 'refresh-failed'); assert.equal(h.owner.snapshot().document?.revision, 8); await h.owner.close();
});

test('retired host keeps returned ACK truth but publishes no stale document/receipt', async () => {
	const h = host(), held = deferred<PhotoLibraryDevelopAcknowledgementV1>(); await h.owner.open('photo'); h.port.apply = () => held.promise;
	const applying = h.owner.apply({ type: 'activate-version', versionId: 'copy' }); await settle(); h.retire();
	held.resolve({ snapshot: snapshot(8, 'copy'), notices: [] }); const receipt = await applying;
	assert.equal(receipt?.snapshot.versionId, 'copy'); assert.equal(h.owner.snapshot().receipt, null);
	assert.equal(h.owner.snapshot().document?.revision, 7); await h.owner.close();
});

test('history/snapshot/version commands use acknowledged revisions and decline wrong version intent', async () => {
	const h = host(); await h.owner.open('photo', 'copy');
	await h.owner.apply({ type: 'select-develop-history', versionId: 'copy', cursor: 0 });
	await h.owner.apply({ type: 'delete-develop-snapshot', versionId: 'copy', snapshotId: 'stored' });
	assert.deepEqual(h.requests.map(request => request.expectedRevision), [7, 8]);
	await h.owner.apply({ type: 'restore-develop-snapshot', versionId: 'master', snapshotId: 'stored', label: 'Restore', createdAt: '2026-10-09T00:00:00.000Z' });
	assert.equal(h.requests.length, 2); await h.owner.close();
});

test('effect replay joins prior writes and an old epoch ACK cannot publish into the resumed owner', async () => {
	const h = host(), held = deferred<PhotoLibraryDevelopAcknowledgementV1>(); await h.owner.open('photo');
	h.port.apply = () => held.promise;
	const work = h.owner.apply({ type: 'activate-version', versionId: 'copy' }); await settle();
	let joined = false; const retired = h.owner.retire().then(() => { joined = true; }); h.owner.resume();
	await h.owner.open('photo'); await settle(); assert.equal(joined, false);
	held.resolve({ snapshot: snapshot(8, 'copy'), notices: [] });
	assert.equal((await work)?.snapshot.revision, 8); await retired;
	assert.equal(h.owner.snapshot().receipt, null); assert.equal(h.owner.snapshot().visible, false);
	h.port.read = async () => snapshot(8, 'copy'); await h.owner.open('photo', 'copy');
	assert.equal(h.owner.snapshot().document?.revision, 8); await h.owner.close();
});

test('a throwing scalar observer cannot strand an operation or erase a known ACK', async () => {
	const h = host(); await h.owner.open('photo'); let first = true;
	h.owner.subscribe(() => { if (first) { first = false; return; } throw new Error('Observer failed'); });
	const receipt = await h.owner.apply({ type: 'activate-version', versionId: 'copy' });
	assert.equal(receipt?.snapshot.revision, 8); assert.equal(h.owner.snapshot().busy, false); await h.owner.close();
});

test('non-scalar photo identity refuses before acquisition without coercion or caller code', async () => {
	const h = host(); let calls = 0;
	await h.owner.open({ toString() { calls++; return 'photo'; } } as unknown as string);
	assert.equal(calls, 0); assert.equal(h.acquired, 0); await h.owner.close();
});
