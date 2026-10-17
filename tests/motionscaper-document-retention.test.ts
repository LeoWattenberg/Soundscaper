/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { copyMotionscaperLayers, pasteMotionscaperLayers } from '../src/motionscaper/editor-layer-clipboard.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
const settings = { title: 'Source', width: 64, height: 64, durationFrames: 60, frameRate: { num: 30, den: 1 } };
const bytes = new Uint8Array([1, 2, 3]); const sha256 = digestScapeBytes(bytes);
const asset = { id: 'image', name: 'Image', kind: 'image' as const, mimeType: 'image/png', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: bytes.byteLength, width: 1, height: 1, hasAlpha: true };
function fixture() { const indexedDB = createInstrumentedIndexedDB(); const store = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory }); let id = 0; return { indexedDB, store, session: new MotionscaperDocumentSession(store, () => `document-${++id}`) }; }

test('M06 unavailable asset closure and failed recovery transaction never publish editor history', async () => {
	const { indexedDB, store, session } = fixture();
	try {
		await session.create(settings); const before = session.getSnapshot(); const observed: unknown[] = []; const unsubscribe = session.subscribe(() => observed.push(session.getSnapshot().project));
		await assert.rejects(session.edit([{ type: 'asset/add', asset }]), /unavailable/iu);
		assert.deepEqual(session.getSnapshot(), before); assert.ok(observed.every((value) => value === before.project));
		indexedDB.failNextPutForStore('projects', new DOMException('Quota exhausted', 'QuotaExceededError'));
		await assert.rejects(session.edit([{ type: 'project/rename', title: 'Failed edit' }]), /Quota/iu);
		assert.deepEqual(session.getSnapshot(), before); assert.equal(await store.loadRecovery(before.project!.id), null);
		unsubscribe(); await session.edit([{ type: 'project/rename', title: 'Accepted edit' }]); assert.equal(session.getSnapshot().canUndo, true);
		await session.undo(); assert.equal(session.getSnapshot().project!.title, settings.title); assert.equal(session.getSnapshot().canUndo, false);
	} finally { await store.close(); }
});
test('M06 cross-project layer paste retains existing immutable bodies without reading or copying chunks', async () => {
	const { indexedDB, store, session } = fixture();
	try {
		await session.create(settings); const source = session.getSnapshot().project!;
		const layer = createMotionLayer({ id: 'layer', name: 'Image', durationFrames: 60, content: { kind: 'image', assetId: asset.id } });
		await session.edit([{ type: 'asset/add', asset }, { type: 'layer/add', compositionId: source.primaryCompositionId, layer, index: 0 }], [{ asset, body: new Blob([bytes]) }]);
		const clipboard = copyMotionscaperLayers({ project: session.getSnapshot().project, compositionId: source.primaryCompositionId, layerIds: [layer.id] });
		await session.create({ ...settings, title: 'Destination' }); const target = session.getSnapshot().project!;
		const paste = pasteMotionscaperLayers({ project: target, compositionId: target.primaryCompositionId, clipboard, index: 0, createId: (kind, id) => `${kind}-${id}` });
		const chunks = indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'chunks'); const readCount = indexedDB.stats.getRequests.length;
		await session.edit(paste.commands); assert.ok(indexedDB.stats.getRequests.slice(readCount).every((request: { store: string }) => request.store !== 'chunks')); assert.equal(indexedDB.recordCount('kw-media-motionscaper-editor-v1', 'chunks'), chunks);
		const recovery = await store.loadRecovery(target.id); assert.equal(recovery?.assets[0]?.sha256, asset.sha256); assert.equal(recovery?.compositions[0]?.layers[0]?.kind, 'image');
		assert.equal((await store.readAsset(recovery!.assets[0]))?.size, bytes.byteLength); assert.equal((await store.load(source.id))?.project.assets.length, 0);
		assert.equal((await store.loadRecovery(source.id))?.assets[0]?.sha256, asset.sha256);
	} finally { await store.close(); }
});
