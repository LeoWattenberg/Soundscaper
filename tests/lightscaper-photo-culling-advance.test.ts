/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryCullingV1, type PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import { PhotoLibrarySelectionV1 } from '../src/common/editor/controller/shared/photo-library-selection-v1.ts';
import { capturePhotoLibraryCullAdvanceRequestV1, type PhotoLibraryCullAdvanceRequestV1 as Advance } from '../src/common/editor/controller/shared/photo-library-cull-advance-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const ids = (start: number, count: number) => Array.from({ length: count }, (_, offset) => `photo-${start + offset}`);
function page(photoIds: readonly string[]): PhotoLibraryPageV1 {
	return Object.freeze({ catalogName: 'Library', totalCount: 80, cursor: null, rows: Object.freeze(photoIds.map(id => Object.freeze({
		id, fileName: `${id}.png`, width: 1, height: 1, rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const }))) });
}
function setup(photoIds = ids(0, 64), selectedId = photoIds.at(-1)!) {
	const initial = page(photoIds), selection = new PhotoLibrarySelectionV1();
	selection.setPage(photoIds, { generation: 'library', pageIdentity: initial }); selection.select(selectedId);
	return { initial, selection, culling: new PhotoLibraryCullingV1(selection) };
}
const saved = (photoId: string, published: PhotoLibraryPageV1): PhotoLibraryCullReceiptV1 =>
	Object.freeze({ outcome: 'saved', photoId, page: published, notice: null });

test('row 64 advances to the joined next-page identity only after its actual saved page receipt', async () => {
	const { selection, culling } = setup(), entered = deferred<void>(), result = deferred<PhotoLibraryCullReceiptV1>();
	const next = ids(64, 16), published = page(['newcomer', ...next]); let request: Advance | undefined;
	const work = culling.execute('photo-63', async (_signal, advance?: Advance) => {
		entered.resolve(); assert.ok(advance, 'Enabled last-row culling must request joined lookahead.'); request = advance;
		assert.equal(Object.isFrozen(advance), true); assert.equal(Object.isFrozen(advance.successorIds), true);
		assert.deepEqual(advance.successorIds, []); assert.equal(advance.isCurrent(), true);
		advance.captureNextPage(next); next[0] = 'caller-mutated'; entered.resolve(); return result.promise;
	}, { autoAdvance: true });
	try {
		await entered.promise; assert.equal(selection.snapshot().primaryId, 'photo-63');
		assert.equal(await remainsPending(work), true); result.resolve(saved('photo-63', published));
		assert.equal((await work).outcome, 'saved'); assert.equal(selection.snapshot().primaryId, 'photo-64');
		assert.equal(selection.snapshot().focusedId, 'photo-64'); assert.equal(request?.isCurrent(), false);
		assert.throws(() => request!.captureNextPage(['late']), /settled|sealed|captured/u);
	} finally { result.resolve({ outcome: 'cancelled' }); await work; }
});

test('old successor order wins over refreshed ranks and new arrivals across the boundary', async () => {
	const { selection, culling } = setup(['a', 'b', 'c'], 'a');
	const receipt = await culling.execute('a', async (_signal, advance?: Advance) => {
		assert.ok(advance); assert.deepEqual(advance.successorIds, ['b', 'c']); advance.captureNextPage(['d', 'e']);
		return saved('a', page(['newcomer', 'e', 'c', 'b', 'd']));
	}, { autoAdvance: true });
	assert.equal(receipt.outcome, 'saved');
	assert.equal(selection.snapshot().primaryId, 'b');
});

test('only enabled single selected and focused culling supplies an advance request', async () => {
	for (const mode of ['off', 'multiple', 'other-focus', 'unselected']) {
		const { selection, culling, initial } = setup(['a', 'b'], 'a');
		if (mode === 'multiple') selection.select('b', { toggle: true });
		if (mode === 'other-focus') selection.focus('b');
		if (mode === 'unselected') selection.clear();
		const before = selection.snapshot();
		const receipt = await culling.execute('a', async (_signal, advance?: Advance) => {
			assert.equal(advance, undefined); return saved('a', initial);
		}, { autoAdvance: mode !== 'off' });
		assert.equal(receipt.outcome, 'saved');
		assert.deepEqual(selection.snapshot().selectedIds, before.selectedIds);
	}
});

test('one dense bounded capture rejects accessors, duplicates, old-page IDs and future data without getter execution', async () => {
	let getters = 0;
	const accessor = Object.defineProperty(['d'], '0', { enumerable: true, get() { getters++; return 'd'; } });
	for (const invalid of [accessor, ['d', 'd'], ['b'], ['a'], Array<string>(1), ids(100, 65), [''], ['d', 1]]) {
		const { selection, culling, initial } = setup(['a', 'b'], 'a');
		const receipt = await culling.execute('a', async (_signal, advance?: Advance) => {
			assert.ok(advance); assert.throws(() => advance.captureNextPage(invalid as readonly string[]));
			assert.throws(() => advance.captureNextPage(['d']), /captured/u); return saved('a', initial);
		}, { autoAdvance: true });
		assert.equal(receipt.outcome, 'saved');
		assert.equal(selection.snapshot().primaryId, 'b');
	}
	assert.equal(getters, 0);
});

test('capture is claimed before reflecting a reentrant array and accepts no second delivery', async () => {
	const { selection, culling } = setup(['a'], 'a'); let attempts = 0;
	const receipt = await culling.execute('a', async (_signal, advance?: Advance) => {
		assert.ok(advance);
		const next = new Proxy(['b'], { getOwnPropertyDescriptor(target, key) {
			if (key === 'length') { attempts++; assert.throws(() => advance.captureNextPage(['c']), /captured/u); }
			return Reflect.getOwnPropertyDescriptor(target, key);
		} });
		advance.captureNextPage(next); assert.throws(() => advance.captureNextPage(['c']), /captured/u);
		return saved('a', page(['c', 'b']));
	}, { autoAdvance: true });
	assert.equal(receipt.outcome, 'saved');
	assert.equal(attempts, 1); assert.equal(selection.snapshot().primaryId, 'b');
});

test('retained successor IDs never exceed 64 and never wrap to an uncaptured newcomer', async () => {
	const { selection, culling } = setup(['a', 'b'], 'a');
	const receipt = await culling.execute('a', async (_signal, advance?: Advance) => {
		assert.ok(advance); advance.captureNextPage(ids(100, 64)); return saved('a', page(['a', 'photo-163']));
	}, { autoAdvance: true });
	assert.equal(receipt.outcome, 'saved');
	assert.equal(selection.snapshot().primaryId, 'a', 'The 65th combined successor is not admitted.');
});

test('manual interaction, foreign page, generation and pause invalidate lookahead without losing saved ACK', async () => {
	for (const change of ['focus', 'reselect', 'page', 'generation', 'pause']) {
		const { selection, culling, initial } = setup(['a', 'b'], 'a'), entered = deferred<void>(), result = deferred<PhotoLibraryCullReceiptV1>();
		let request: Advance | undefined;
		const work = culling.execute('a', async (_signal, advance?: Advance) => {
			entered.resolve(); assert.ok(advance); request = advance; advance.captureNextPage(['c']); return result.promise;
		}, { autoAdvance: true });
		try {
			await entered.promise;
			if (change === 'focus') selection.focus('b');
			if (change === 'reselect') selection.select('a');
			if (change === 'page' || change === 'generation') selection.setPage(['a', 'b'], {
				generation: change === 'generation' ? 'replacement' : 'library', pageIdentity: page(['a', 'b']) });
			const closing = change === 'pause' ? culling.pause() : Promise.resolve();
			assert.equal(request!.isCurrent(), false); const before = selection.snapshot();
			result.resolve(saved('a', initial)); assert.equal((await work).outcome, 'saved'); await closing;
			assert.deepEqual(selection.snapshot(), before);
		} finally { result.resolve({ outcome: 'cancelled' }); await work; }
	}
});

test('the external query fence is pinned before yield and blocks late page publication while preserving ACK', async () => {
	const { selection, culling, initial } = setup(['a'], 'a'), entered = deferred<void>(), result = deferred<PhotoLibraryCullReceiptV1>();
	let current = true, request: Advance | undefined;
	const options = { autoAdvance: true, isCurrent: () => current };
	const work = culling.execute('a', async (_signal, advance?: Advance) => {
		entered.resolve(); assert.ok(advance); request = advance; advance.captureNextPage(['b']); return result.promise;
	}, options);
	try {
		await entered.promise; options.isCurrent = () => true; current = false; assert.equal(request!.isCurrent(), false);
		result.resolve(saved('a', page(['b']))); assert.equal((await work).outcome, 'saved');
		assert.equal(selection.snapshot().primaryId, 'a'); assert.equal(selection.capture().pageIdentity, initial);
	} finally { result.resolve({ outcome: 'cancelled' }); await work; }
});

test('save refusal seals the request and preserves the original page and selection', async () => {
	const { selection, culling, initial } = setup(['a'], 'a'); let request: Advance | undefined;
	const receipt = await culling.execute('a', async (_signal, advance?: Advance) => {
		assert.ok(advance); request = advance; advance.captureNextPage(['b']); throw Symbol('native refusal');
	}, { autoAdvance: true });
	assert.deepEqual(receipt, { outcome: 'failed' }); assert.equal(request!.isCurrent(), false);
	assert.throws(() => request!.captureNextPage(['c']));
	assert.equal(selection.capture().pageIdentity, initial); assert.equal(selection.snapshot().primaryId, 'a');
});

test('a throwing currentness observer cannot replace the durable saved receipt', async () => {
	const { culling, selection, initial } = setup(['a'], 'a'), failure = Symbol('query observer');
	const receipt = await culling.execute('a', async () => saved('a', page(['b'])), {
		autoAdvance: true, isCurrent: () => { throw failure; } });
	assert.equal(receipt.outcome, 'saved'); assert.equal(selection.capture().pageIdentity, initial);
	assert.equal(selection.snapshot().primaryId, 'a');
});

test('a page publication observer can retire the query before final auto-selection without losing ACK', async () => {
	const { culling, selection } = setup(['a', 'b'], 'a'), published = page(['a', 'b']); let current = true;
	selection.subscribe(snapshot => { if (snapshot.photoIds.length === 2 && selection.capture().pageIdentity === published) current = false; });
	const receipt = await culling.execute('a', async () => saved('a', published), { autoAdvance: true, isCurrent: () => current });
	assert.equal(receipt.outcome, 'saved'); assert.equal(selection.snapshot().primaryId, 'a');
});

test('workflow admission detaches the IDs and pins both native-free callbacks with their real receiver', () => {
	const original = ['b']; let calls = 0;
	const input = { successorIds: original, isCurrent() { assert.equal(this, input); calls++; return true; },
		captureNextPage(next: readonly string[]) { assert.equal(this, input); assert.deepEqual(next, ['c']); calls++; } };
	const captured = capturePhotoLibraryCullAdvanceRequestV1(input); original[0] = 'mutation';
	input.isCurrent = () => false; input.captureNextPage = () => { assert.fail('A replacement callback must not be invoked.'); };
	assert.equal(Object.isFrozen(captured), true); assert.deepEqual(captured.successorIds, ['b']);
	assert.equal(captured.isCurrent(), true); captured.captureNextPage(['c']); assert.equal(calls, 2);
});

test('workflow admission refuses future, inherited, getter, sparse and over-limit request data before invoking methods', () => {
	let calls = 0; const valid = { successorIds: ['b'], isCurrent: () => true, captureNextPage: () => undefined };
	const getter = Object.defineProperty({ ...valid }, 'isCurrent', { enumerable: true, get() { calls++; return valid.isCurrent; } });
	for (const invalid of [getter, { ...valid, future: true }, Object.create(valid), { ...valid, successorIds: Array<string>(1) },
		{ ...valid, successorIds: ids(0, 65) }, { ...valid, successorIds: ['b', 'b'] }, { ...valid, isCurrent: true }, { ...valid, captureNextPage: undefined }]) {
		assert.throws(() => capturePhotoLibraryCullAdvanceRequestV1(invalid));
	}
	assert.equal(calls, 0);
	assert.throws(() => capturePhotoLibraryCullAdvanceRequestV1({ ...valid, isCurrent: () => Promise.resolve(true) }).isCurrent(), /synchronous/u);
	assert.throws(() => capturePhotoLibraryCullAdvanceRequestV1({ ...valid, captureNextPage: () => Promise.resolve() }).captureNextPage(['c']), /synchronously/u);
});
