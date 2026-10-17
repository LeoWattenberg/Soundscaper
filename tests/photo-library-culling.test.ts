/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryCullingV1, type PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import { PhotoLibrarySelectionV1 } from '../src/common/editor/controller/shared/photo-library-selection-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function page(ids = ['a', 'b', 'c']): PhotoLibraryPageV1 {
	return Object.freeze({ catalogName: 'Library', totalCount: ids.length, cursor: null, rows: Object.freeze(ids.map(id => Object.freeze({
		id, fileName: `${id}.png`, width: 1, height: 1, rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const }))) });
}
function setup(ids?: string[]) {
	const initial = page(ids), selection = new PhotoLibrarySelectionV1();
	selection.setPage(initial.rows.map(row => row.id), { generation: 'library', pageIdentity: initial }); selection.select(initial.rows[0]!.id);
	return { selection, culling: new PhotoLibraryCullingV1(selection), initial };
}
const saved = (published: PhotoLibraryPageV1, photoId = 'a'): PhotoLibraryCullReceiptV1 => ({ outcome: 'saved', photoId, page: published, notice: null });

test('acknowledged culling advances by captured successor identity after filter and rank changes', async () => {
	const { selection, culling } = setup(), published = page(['c', 'b']);
	const receipt = await culling.execute('a', async () => saved(published), { autoAdvance: true });
	assert.equal(receipt.outcome, 'saved'); assert.equal(receipt.outcome === 'saved' && receipt.page, published);
	assert.equal(selection.snapshot().primaryId, 'b', 'the first pre-edit successor survives despite its new array position');
	assert.equal(selection.snapshot().focusedId, 'b'); assert.deepEqual(selection.snapshot().photoIds, ['c', 'b']);
	assert.equal(culling.snapshot().pendingPhotoId, null);
});

test('an own page publication before receipt is permitted, while unrelated page and generation changes fence it', async () => {
	for (const replacement of ['own', 'unrelated', 'generation']) {
		const { selection, culling } = setup(), result = deferred<PhotoLibraryCullReceiptV1>(), published = page(['b', 'c']);
		const work = culling.execute('a', async () => result.promise, { autoAdvance: true }); await Promise.resolve();
		selection.setPage(['b', 'c'], { generation: replacement === 'generation' ? 'new-library' : 'library',
			pageIdentity: replacement === 'own' ? published : page(['b', 'c']) });
		result.resolve(saved(published)); await work;
		assert.equal(selection.snapshot().primaryId, replacement === 'own' ? 'b' : null);
	}
});

test('failed saves, conflicts and cancellations before acknowledgment preserve selection', async () => {
	for (const save of [async () => ({ outcome: 'failed' as const }), async () => ({ outcome: 'cancelled' as const }),
		async () => { throw new Error('revision conflict'); }]) {
		const { selection, culling } = setup();
		const receipt = await culling.execute('a', save, { autoAdvance: true });
		assert.ok(receipt.outcome === 'failed' || receipt.outcome === 'cancelled');
		assert.equal(selection.snapshot().primaryId, 'a'); assert.equal(selection.snapshot().focusedId, 'a');
	}
});

test('durable acknowledgment plus refresh failure remains saved and pauses advance with a scalar notice', async () => {
	const { selection, culling } = setup();
	assert.deepEqual(await culling.execute('a', async () => {
		const fallback = page(); selection.setPage(['a', 'b', 'c'], { generation: 'library', pageIdentity: fallback });
		return { outcome: 'saved', photoId: 'a', page: null, notice: 'refresh-failed' };
	}, { autoAdvance: true }),
		{ outcome: 'saved', photoId: 'a', page: null, notice: 'refresh-failed' });
	assert.equal(selection.snapshot().primaryId, 'a'); assert.equal(culling.snapshot().notice, 'refresh-failed');
});

test('manual focus, explicit reselection and multiselection prevent a later acknowledged advance', async () => {
	for (const change of [(selection: PhotoLibrarySelectionV1) => { selection.focus('c'); },
		(selection: PhotoLibrarySelectionV1) => { selection.select('a'); },
		(selection: PhotoLibrarySelectionV1) => { selection.select('c', { toggle: true }); }]) {
		const { selection, culling, initial } = setup(), result = deferred<PhotoLibraryCullReceiptV1>();
		const work = culling.execute('a', async () => result.promise, { autoAdvance: true }); await Promise.resolve();
		change(selection); const before = selection.snapshot(); result.resolve(saved(initial)); await work;
		assert.deepEqual(selection.snapshot(), before);
	}
	const { selection, culling, initial } = setup(); selection.select('c', { toggle: true });
	await culling.execute('a', async () => saved(initial), { autoAdvance: true });
	assert.deepEqual(selection.snapshot().selectedIds, ['a', 'c']);
});

test('last-row and filtered-out successors stop without wrapping or consuming an old cursor', async () => {
	const { selection, culling } = setup(); selection.select('c');
	await culling.execute('c', async () => saved(page(['a', 'b', 'c']), 'c'), { autoAdvance: true });
	assert.equal(selection.snapshot().primaryId, 'c');
	selection.select('a'); await culling.execute('a', async () => saved(page(['new', 'a'])), { autoAdvance: true });
	assert.equal(selection.snapshot().primaryId, 'a');
	await culling.execute('a', async () => saved(page(['a', 'new'])), { autoAdvance: false });
	assert.equal(selection.snapshot().primaryId, 'a');
});

test('one pending cull admits no queued keys and pause joins a save that acknowledges after cancellation', async () => {
	const { selection, culling, initial } = setup(), result = deferred<PhotoLibraryCullReceiptV1>();
	let calls = 0, signal: AbortSignal | undefined;
	const work = culling.execute('a', async current => { calls++; signal = current; return result.promise; }, { autoAdvance: true });
	await Promise.resolve(); assert.equal(culling.snapshot().pendingPhotoId, 'a');
	assert.deepEqual(await culling.execute('b', async () => { calls++; return saved(initial, 'b'); }, { autoAdvance: true }), { outcome: 'busy' });
	const closing = culling.pause(); assert.equal(signal?.aborted, true); assert.equal(await remainsPending(closing), true);
	result.resolve(saved(initial)); assert.equal((await work).outcome, 'saved'); await closing;
	assert.equal(calls, 1); assert.equal(selection.snapshot().primaryId, 'a');
	await culling.execute('a', async () => saved(initial), { autoAdvance: true }); assert.equal(selection.snapshot().primaryId, 'b');
});

test('pending work is registered before reentrant observers or save ports can pause it', async () => {
	const { selection, culling, initial } = setup(), result = deferred<PhotoLibraryCullReceiptV1>();
	let joining: Promise<void> | undefined, calls = 0;
	culling.subscribe(snapshot => { if (snapshot.pendingPhotoId) joining = culling.pause(); });
	const receipt = await culling.execute('a', async () => { calls++; return saved(initial); }, { autoAdvance: true });
	await joining; assert.equal(receipt.outcome, 'cancelled'); assert.equal(calls, 0);
	const clean = new PhotoLibraryCullingV1(selection);
	const pending = clean.execute('a', async () => { joining = clean.pause(); return result.promise; }, { autoAdvance: true });
	await Promise.resolve(); assert.equal(await remainsPending(joining!), true);
	result.resolve(saved(initial)); assert.equal((await pending).outcome, 'saved'); await joining;
	assert.equal(selection.snapshot().primaryId, 'a');
});

test('strict receipts reject accessors, foreign IDs and original-bearing pages without invoking getters or advancing', async () => {
	const { selection, culling, initial } = setup(); let calls = 0;
	const accessor = Object.defineProperty({}, 'outcome', { enumerable: true, get() { calls++; return 'saved'; } });
	for (const invalid of [accessor, { ...saved(initial), photoId: 'foreign' }, { ...saved(initial), original: 'bytes' },
		{ ...saved(initial), page: { ...initial, rows: [{ ...initial.rows[0], original: 'bytes' }] } },
		{ ...saved(initial), page: { ...initial, rows: Array(1) } }, { ...saved(initial), page: null },
		{ ...saved(initial), notice: 'unsupported' }]) {
		await assert.rejects(culling.execute('a', async () => invalid as PhotoLibraryCullReceiptV1, { autoAdvance: true }));
		assert.equal(selection.snapshot().primaryId, 'a');
	}
	assert.equal(calls, 0);
});

test('a throwing pending observer cannot lose ownership of the caller save receipt', async () => {
	const { culling, initial } = setup(); let calls = 0, pending: Promise<PhotoLibraryCullReceiptV1> | undefined;
	culling.subscribe(snapshot => { if (snapshot.pendingPhotoId !== null) throw new Error('UI pending observer failed'); });
	try {
		pending = culling.execute('a', async () => { calls++; return saved(initial); }, { autoAdvance: false });
		assert.equal((await pending).outcome, 'saved'); assert.equal(calls, 1);
	} finally { await culling.drain(); }
});

test('a throwing selection publication observer cannot turn an acknowledged save into a rejected receipt', async () => {
	const { culling, selection } = setup(), published = page(['b', 'c']); let calls = 0;
	selection.subscribe(snapshot => { if (snapshot.photoIds[0] === 'b') throw new Error('UI selection observer failed'); });
	assert.equal((await culling.execute('a', async () => { calls++; return saved(published); }, { autoAdvance: true })).outcome, 'saved');
	assert.equal(calls, 1); assert.equal(selection.snapshot().primaryId, 'b');
	assert.equal(culling.snapshot().pendingPhotoId, null);
});
