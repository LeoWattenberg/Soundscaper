/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { motionWavFixture } from './helpers/motion-media-fixture.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';

test('imported audio is retained as one recoverable undo step and survives save, reopen and complete archive transfer', async () => {
	const store = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	const other = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	const session = new MotionscaperDocumentSession(store); const reopened = new MotionscaperDocumentSession(other);
	try {
		await session.create({ title: 'Sound', width: 64, height: 64, frameRate: { num: 30, den: 1 }, durationFrames: 30 });
		const saved = session.getSnapshot(); const bytes = motionWavFixture(2);
		await session.importMedia(new Blob([bytes]), 'Stereo.wav');
		const edited = session.getSnapshot().project!;
		assert.equal(edited.assets[0]?.kind, 'audio'); assert.equal(edited.compositions[0]?.audio.length, 1);
		assert.deepEqual(edited.compositions[0]?.audio[0]?.outFrame, { num: 3, den: 1 });
		assert.equal((await store.load(edited.id))?.digest, saved.savedDigest);
		assert.equal((await store.loadRecovery(edited.id))?.assets.length, 1);
		await session.undo(); assert.equal(session.getSnapshot().project?.assets.length, 0);
		assert.equal(session.getSnapshot().project?.compositions[0]?.audio.length, 0);
		await session.redo(); await session.importMedia(new Blob([bytes]), 'Same bytes.wav');
		assert.equal(session.getSnapshot().project?.assets.length, 1); assert.equal(session.getSnapshot().project?.compositions[0]?.audio.length, 2);
		await session.save(); await session.open(edited.id); assert.equal(session.getSnapshot().dirty, false);
		await reopened.importArchive((await session.saveCopy()).blob);
		const imported = reopened.getSnapshot().project!; assert.equal(imported.compositions[0]?.audio.length, 2);
		const body = await other.readAsset(imported.assets[0]!); assert.ok(body);
		assert.deepEqual(new Uint8Array(await new Response(body.stream()).arrayBuffer()), bytes);
		const revision = session.getSnapshot().project?.revision;
		await assert.rejects(session.importMedia(new Blob(['invalid']), 'Invalid.wav'));
		assert.equal(session.getSnapshot().project?.revision, revision);
	} finally { await store.close(); await other.close(); }
});
