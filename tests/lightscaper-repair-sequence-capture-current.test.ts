/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { applyPhotoCommandCurrentV1 } from '../src/lightscaper/controller/photo-commands-current-v1.ts';
import { repairSequenceCurrentFixture, sequenceOutcome } from './helpers/lightscaper-repair-sequence-current-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';
import { SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';

for (const kind of ['manual', 'smart', 'saved'] as const) test(`actual Current ${kind} query retains complete native order without collapsing shared Originals`, async () => {
	const f = await repairSequenceCurrentFixture();
	try { const before = await f.inspect(), expected = f.selectedPhotos.map(photo => photo.id); if (kind === 'saved') expected.reverse();
		await f.capture(async view => {
			assert.deepEqual(view.photos.map(photo => photo.binding.photoId), expected); assert.equal(view.collection.indexRevision >= 0, true);
			assert.equal(view.collection.scope, kind === 'saved' ? 'saved-query' : 'catalog');
			for (const photo of view.photos) await view.withOriginal(photo.binding.photoId, async body => assert.deepEqual(new Uint8Array(await body.arrayBuffer()), f.encoded));
		}, {}, f.binding(kind));
		assert.equal(f.events.filter(value => value === 'original').length, 1); assert.deepEqual(await f.inspect(), before);
		assert.ok(f.events.indexOf('verify:brush') < f.events.indexOf('original'));
	} finally { await f.close(); }
});

test('Current saved Query2 walks empty native candidate pages and preserves its descending final selection', async () => {
	const f = await repairSequenceCurrentFixture({ count: 70, selectAll: false });
	try { await f.capture(view => assert.deepEqual(view.photos.map(photo => photo.binding.photoId), f.selectedPhotos.map(photo => photo.id)), {}, f.manualBinding);
		assert.ok(f.closed.emptyPages > 0);
		await f.capture(view => assert.deepEqual(view.photos.map(photo => photo.binding.photoId), f.selectedPhotos.map(photo => photo.id).reverse()), {}, f.savedBinding);
	} finally { await f.close(); }
});

for (const retainedPlacement of ['redo', 'snapshot', 'inactive'] as const) test(`corrupt ${retainedPlacement}-only brush refuses whole Current capture before Original or partial delivery`, async () => {
	const f = await repairSequenceCurrentFixture({ retainedPlacement }); let consumed = 0;
	try { await f.corruptResource(f.resources.retainedOnly.storageKey); await assert.rejects(f.capture(() => { consumed++; }));
		assert.equal(consumed, 0); assert.equal(f.events.includes('original'), false); assert.equal(f.events.some(value => value.startsWith('brush:')), false);
	} finally { await f.close(); }
});

test('foreign input in the final retained recipe refuses before an earlier valid Photo borrows any body', async () => {
	const f = await repairSequenceCurrentFixture();
	try { const photo = f.photos[1]!, version = photo.versions.find(value => value.id === photo.activeVersionId)!, retained = version.workspace!.entries.at(-1)!.develop;
		const graph = retained.masks[0]!, develop = normalizeImageDevelopStateCurrentV1({ ...retained,
			masks: [{ ...graph, inputs: [...graph.inputs, { name: 'foreign-unused', kind: 'alpha', sourceRef: 'external-alpha-map' }] }] });
		let changed = applyPhotoCommandCurrentV1(photo, { type: 'record-develop', versionId: version.id, develop, label: 'Foreign retained', createdAt: SETTINGS_TIME });
		changed = applyPhotoCommandCurrentV1(changed, { type: 'select-develop-history', cursor: 0 }); f.change(changed, 1);
		await assert.rejects(f.capture(() => assert.fail('Foreign retained namespace must not deliver.'))); assert.deepEqual(f.events, []);
	} finally { await f.close(); }
});

test('complete same-revision Photo facts drift during held Original refuses before delivering the collection', async () => {
	const f = await repairSequenceCurrentFixture(), entered = deferred<void>(), release = deferred<void>(); let consumed = 0;
	f.hooks.original = async () => { entered.resolve(); await release.promise; };
	const work = f.capture(() => { consumed++; }), outcome = sequenceOutcome(work);
	try { const first = await Promise.race([entered.promise.then(() => 'entered'), outcome.then(() => 'settled')]); assert.equal(first, 'entered');
		const photo = f.photos.at(-1)!; f.change(normalizePhotoDocumentCurrentV1({ ...photo, metadata: { ...photo.metadata, caption: 'Same revision drift' } }), f.photos.length - 1);
		release.resolve(); const result = await outcome; assert.equal(result.ok, false); assert.equal(consumed, 0);
	} finally { release.resolve(); await outcome; await f.close(); }
});

test('saved definition complete facts and native root/index changes refuse after a held Current consumer', async () => {
	for (const drift of ['definition', 'root', 'index'] as const) {
		const f = await repairSequenceCurrentFixture(), entered = deferred<void>(), release = deferred<void>();
		const work = f.capture(async () => { entered.resolve(); await release.promise; }, {}, f.savedBinding), outcome = sequenceOutcome(work);
		try { assert.equal(await Promise.race([entered.promise.then(() => 'entered'), outcome.then(() => 'settled')]), 'entered');
			if (drift === 'definition') f.changeDefinition({ ...f.definition, name: 'Same revision new name' });
			else if (drift === 'root') await f.catalog.saveCatalog({ ...f.root, name: 'Changed catalog' }, f.root.revision);
			else { const photo = f.photos.at(-1)!, saved = await f.catalog.savePhoto({ ...photo, metadata: { ...photo.metadata, caption: 'Native index write' } }, photo.revision);
				assert.equal(saved.revision, photo.revision + 1); }
			release.resolve(); assert.equal((await outcome).ok, false);
		} finally { release.resolve(); await outcome; await f.close(); }
	}
});

test('whole retained facts and canonical source work limits refuse Current capture before body acquisition', async () => {
	const f = await repairSequenceCurrentFixture({ count: 32, mixed: false });
	try { for (const [index, photo] of f.photos.entries()) f.change({ ...photo, metadata: { ...photo.metadata,
		caption: 'x'.repeat(16384), creator: 'y'.repeat(16384), copyright: 'z'.repeat(16384), location: 'w'.repeat(16384) } }, index);
		await assert.rejects(f.capture(() => assert.fail('Retained facts must be bounded.')), /capacity|budget/iu); assert.deepEqual(f.events, []);
	} finally { await f.close(); }
	const wide = await repairSequenceCurrentFixture();
	try { const photo = wide.photos[0]!; wide.change({ ...photo, original: { ...photo.original, width: 8192, height: 8192 } }, 0);
		await assert.rejects(wide.capture(() => assert.fail('Canonical expansion must be preflighted.'))); assert.deepEqual(wide.events, []);
	} finally { await wide.close(); }
});
