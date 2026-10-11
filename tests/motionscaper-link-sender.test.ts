/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createMotionscaperLinkSender } from '../src/motionscaper/editor-link-sender.ts';
import { normalizeMotionCompositionOffer, type MotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const settings = { title: 'Saved', width: 2, height: 2, frameRate: { num: 30, den: 1 }, durationFrames: 2 };
test('Motion sender publishes saved heads only and coalesces updates behind receiver backpressure', async () => {
	const store = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory }); let id = 0;
	const session = new MotionscaperDocumentSession(store, () => `item-${++id}`); await session.create(settings);
	const started = deferred<void>(), release = deferred<void>(), closed = deferred<void>(); const offers: MotionCompositionOffer[] = [];
	const sender = createMotionscaperLinkSender({ session, store, senderOrigin: 'http://localhost:1001', receiverOrigin: 'http://localhost:1002', openConnection: async () => ({
		async send(value) { const offer = normalizeMotionCompositionOffer(value); offers.push(offer); if (offers.length === 1) { started.resolve(); await release.promise; } return offer.revision.digest; }, closed: closed.promise, async dispose() { closed.resolve(); },
	}) });
	try {
		const connecting = sender.connect('http://localhost:1002/pair', session.getSnapshot().project!.primaryCompositionId); await started.promise;
		await session.changeSettings({ ...settings, title: 'Draft' }); await session.saveCopy(); assert.equal(offers.length, 1);
		await session.save(); await session.changeSettings({ ...settings, title: 'Latest saved' }); await session.save();
		release.resolve(); await connecting; await sender.settled();
		assert.deepEqual(offers.map(offer => offer.revision.project.title), ['Saved', 'Latest saved']);
		assert.equal(sender.getSnapshot().lastDigest, session.getSnapshot().savedDigest);
		await session.changeSettings({ ...settings, title: 'Not published' }); await session.undo(); await sender.settled(); assert.equal(offers.length, 2);
		await sender.disconnect(); await session.save(); await sender.settled(); assert.equal(offers.length, 2);
	} finally { await sender.dispose(); await store.close(); }
});
test('Motion sender closes an established connection when the editor changes project', async () => {
	const store = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory }); let id = 0; let disposed = 0;
	const session = new MotionscaperDocumentSession(store, () => `item-${++id}`); await session.create(settings); const closed = deferred<void>();
	const sender = createMotionscaperLinkSender({ session, store, senderOrigin: 'http://localhost:1001', receiverOrigin: 'http://localhost:1002', openConnection: async () => ({ send: async value => normalizeMotionCompositionOffer(value).revision.digest, closed: closed.promise, async dispose() { disposed++; closed.resolve(); } }) });
	try { await sender.connect('pair', session.getSnapshot().project!.primaryCompositionId); await session.create(settings); await sender.settled(); assert.equal(disposed, 1); assert.equal(sender.getSnapshot().status, 'idle'); }
	finally { await sender.dispose(); await store.close(); }
});

test('a failed sender disconnect does not skip cleanup of a later connection', async () => {
	const store = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory }); let id = 0, disposed = 0;
	const session = new MotionscaperDocumentSession(store, () => `item-${++id}`); await session.create(settings);
	const sender = createMotionscaperLinkSender({ session, store, senderOrigin: 'http://localhost:1001', receiverOrigin: 'http://localhost:1002', openConnection: async () => ({
		send: async value => normalizeMotionCompositionOffer(value).revision.digest, closed: new Promise<void>(() => undefined), async dispose() { if (++disposed === 1) throw new Error('Disconnect failed'); },
	}) });
	try {
		await sender.connect('pair', session.getSnapshot().project!.primaryCompositionId); await assert.rejects(sender.disconnect(), /Disconnect failed/u);
		await sender.connect('pair', session.getSnapshot().project!.primaryCompositionId); await sender.dispose(); assert.equal(disposed, 2);
	} finally { await store.close(); }
});
