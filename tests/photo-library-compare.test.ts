/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryCompareV1 } from '../src/common/editor/controller/shared/photo-library-compare-v1.ts';
import type { PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function page(ids = ['a', 'b', 'c', 'd']): PhotoLibraryPageV1 {
	return Object.freeze({ catalogName: 'Library', totalCount: ids.length, cursor: null,
		rows: Object.freeze(ids.map(id => Object.freeze({ id, fileName: `${id}.png`, width: 1, height: 1,
			rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const }))) });
}
const context = (pageIdentity: unknown, generation: unknown = 'library') => ({ generation, pageIdentity });
const saved = (published: PhotoLibraryPageV1, photoId = 'b'): PhotoLibraryCullReceiptV1 =>
	({ outcome: 'saved', photoId, page: published, notice: null });
function setup(ids = ['a', 'b', 'c', 'd']) {
	const owner = new PhotoLibraryCompareV1(), initial = page(ids);
	void owner.setPage(ids, context(initial)); owner.open(ids);
	return { owner, initial };
}

test('Compare is closed until explicitly opened and captures a detached subset in visible order', async () => {
	const owner = new PhotoLibraryCompareV1(), initial = page();
	assert.deepEqual(owner.snapshot(), { open: false, photoIds: [], referenceId: null, candidateId: null,
		pendingPhotoId: null, notice: null });
	await owner.setPage(['a', 'b', 'c', 'd'], context(initial));
	assert.equal(owner.snapshot().open, false);
	const selected = ['d', 'a', 'c']; owner.open(selected); selected[0] = 'foreign';
	assert.deepEqual(owner.snapshot().photoIds, ['a', 'c', 'd']);
	assert.equal(owner.snapshot().referenceId, 'a'); assert.equal(owner.snapshot().candidateId, 'c');
	assert.ok(Object.isFrozen(owner.snapshot())); assert.ok(Object.isFrozen(owner.snapshot().photoIds));
});

test('candidate navigation skips the reference, never wraps, and swap/promote preserve distinct sides', () => {
	const { owner } = setup();
	owner.previous(); assert.equal(owner.snapshot().candidateId, 'b');
	owner.next(); assert.equal(owner.snapshot().candidateId, 'c');
	owner.next(); owner.next(); assert.equal(owner.snapshot().candidateId, 'd');
	owner.swap(); assert.equal(owner.snapshot().referenceId, 'd'); assert.equal(owner.snapshot().candidateId, 'a');
	owner.next(); assert.equal(owner.snapshot().candidateId, 'b');
	owner.promoteCandidate(); assert.equal(owner.snapshot().referenceId, 'b'); assert.equal(owner.snapshot().candidateId, 'c');
	owner.next(); owner.promoteCandidate();
	assert.equal(owner.snapshot().referenceId, 'd'); assert.equal(owner.snapshot().candidateId, 'b');
});

test('unrelated page and generation replacement retire the captured view while identical context is inert', async () => {
	const { owner, initial } = setup();
	await owner.setPage(['a', 'b', 'c', 'd'], context(initial)); assert.equal(owner.snapshot().open, true);
	await owner.setPage(['a', 'b', 'c', 'd'], context(page())); assert.equal(owner.snapshot().open, false);
	owner.open(['a', 'b']);
	await owner.setPage(['a', 'b', 'c', 'd'], context(initial, {})); assert.equal(owner.snapshot().open, false);
	assert.deepEqual(owner.snapshot().photoIds, []);
});

test('closed inert admission refuses invalid subsets, context accessors and same-page ID changes before mutation', () => {
	const { owner, initial } = setup(); let getters = 0;
	const accessor = ['a', 'b']; Object.defineProperty(accessor, '0', { enumerable: true, get() { getters++; return 'a'; } });
	const cyclic: unknown[] = []; cyclic.push(cyclic, 'a');
	const before = owner.snapshot();
	for (const ids of [[], ['a'], ['a', 'a'], ['a', 'foreign'], Array(2), accessor, cyclic,
		Array.from({ length: 65 }, (_, index) => `photo-${index}`), ['a', 'x'.repeat(257)]]) {
		assert.throws(() => owner.open(ids as string[])); assert.deepEqual(owner.snapshot(), before);
	}
	const hostile = Object.defineProperty({ generation: 'library' }, 'pageIdentity', { enumerable: true,
		get() { getters++; return initial; } });
	assert.throws(() => owner.setPage(['a', 'b'], hostile as ReturnType<typeof context>));
	assert.throws(() => owner.setPage(['a', 'b'], { ...context(initial), original: 'bytes' } as ReturnType<typeof context>));
	assert.throws(() => owner.setPage(['a', 'b'], context(initial)));
	assert.equal(getters, 0); assert.deepEqual(owner.snapshot(), before);
});

test('opaque context values are never traversed and the full legal page remains bounded', async () => {
	const owner = new PhotoLibraryCompareV1(), ids = Array.from({ length: 64 }, (_, index) => `photo-${index}`);
	const opaque = new Proxy({}, { get() { throw new Error('Opaque token traversed'); }, ownKeys() { throw new Error('Opaque token enumerated'); } });
	await owner.setPage(ids, context(opaque, opaque)); owner.open(ids);
	assert.equal(owner.snapshot().photoIds.length, 64); assert.notEqual(owner.snapshot().referenceId, owner.snapshot().candidateId);
	for (let index = 0; index < 256; index++) {
		if (index % 5 === 0) owner.promoteCandidate(); else if (index % 7 === 0) owner.swap(); else if (index % 2) owner.next(); else owner.previous();
		const snapshot = owner.snapshot(); assert.equal(snapshot.photoIds.length, 64);
		assert.ok(ids.includes(snapshot.referenceId!)); assert.ok(ids.includes(snapshot.candidateId!));
		assert.notEqual(snapshot.referenceId, snapshot.candidateId);
	}
});

test('durable candidate culling reconciles filtered/reordered own page and advances by captured identity', async () => {
	const { owner } = setup(), published = page(['d', 'c', 'a']);
	const receipt = await owner.executeCull('b', async () => saved(published), { autoAdvance: true });
	assert.equal(receipt.outcome, 'saved'); assert.equal(receipt.outcome === 'saved' && receipt.page, published);
	assert.deepEqual(owner.snapshot().photoIds, ['a', 'c', 'd']);
	assert.equal(owner.snapshot().referenceId, 'a'); assert.equal(owner.snapshot().candidateId, 'c');
	assert.equal(owner.snapshot().pendingPhotoId, null);
});

test('reference culling preserves the candidate and candidate advance remains an explicit choice', async () => {
	const { owner } = setup();
	await owner.executeCull('a', async () => saved(page(), 'a'), { autoAdvance: true });
	assert.equal(owner.snapshot().referenceId, 'a'); assert.equal(owner.snapshot().candidateId, 'b');
	await owner.executeCull('b', async () => saved(page()), { autoAdvance: false });
	assert.equal(owner.snapshot().candidateId, 'b');
	await owner.executeCull('b', async () => saved(page(['b', 'c', 'd'])), { autoAdvance: false });
	assert.equal(owner.snapshot().referenceId, 'b'); assert.equal(owner.snapshot().candidateId, 'c');
});

test('React may publish the exact own receipt page before the save promise settles without losing the pair', async () => {
	const { owner } = setup(), held = deferred<PhotoLibraryCullReceiptV1>(), entered = deferred<void>(), published = page(['d', 'a', 'c']);
	const work = owner.executeCull('b', async () => { entered.resolve(); return held.promise; }, { autoAdvance: true }); await entered.promise;
	const replacement = owner.setPage(['d', 'a', 'c'], context(published));
	assert.equal(owner.snapshot().open, false); assert.equal(owner.snapshot().pendingPhotoId, 'b');
	assert.equal(await remainsPending(replacement), true);
	held.resolve(saved(published)); assert.equal((await work).outcome, 'saved'); await replacement;
	assert.equal(owner.snapshot().open, true); assert.equal(owner.snapshot().candidateId, 'c');
	assert.equal(owner.snapshot().referenceId, 'a'); assert.deepEqual(owner.snapshot().photoIds, ['a', 'c', 'd']);
	await owner.setPage(['d', 'a', 'c'], context(published)); assert.equal(owner.snapshot().open, true);
});

test('an early published identity with conflicting scalar IDs retires Compare without losing its valid durable ACK', async () => {
	const { owner } = setup(), published = page(['a', 'c', 'd']);
	const receipt = await owner.executeCull('b', async () => {
		void owner.setPage(['a', 'b', 'd'], context(published));
		return saved(published);
	}, { autoAdvance: true });
	assert.equal(receipt.outcome, 'saved'); assert.equal(receipt.outcome === 'saved' && receipt.page, published);
	assert.deepEqual(owner.snapshot(), { open: false, photoIds: [], referenceId: null, candidateId: null,
		pendingPhotoId: null, notice: null });
});

test('unrelated page, generation and explicit close join late ACKs without resurrecting stale Compare state', async () => {
	for (const replacement of ['page', 'generation', 'close']) {
		const { owner } = setup(), held = deferred<PhotoLibraryCullReceiptV1>(); let aborted = false;
		const work = owner.executeCull('b', async signal => { signal.addEventListener('abort', () => { aborted = true; }); return held.promise; }, { autoAdvance: true });
		await Promise.resolve(); await Promise.resolve();
		const joining = replacement === 'close' ? owner.close() : owner.setPage(['a', 'c', 'd'], context(page(['a', 'c', 'd']), replacement === 'generation' ? 'other' : 'library'));
		assert.equal(await remainsPending(joining), true); assert.equal(aborted, true);
		held.resolve(saved(page(['a', 'c', 'd']))); assert.equal((await work).outcome, 'saved'); await joining;
		assert.equal(owner.snapshot().open, false); assert.deepEqual(owner.snapshot().photoIds, []);
	}
});

test('saved refresh failure pauses advance and cannot grant an acknowledged identity to a fallback page', async () => {
	for (const fallback of [false, true]) {
		const { owner } = setup();
		const receipt = await owner.executeCull('b', async () => {
			if (fallback) void owner.setPage(['a', 'b', 'c', 'd'], context(page()));
			return { outcome: 'saved', photoId: 'b', page: null, notice: 'refresh-failed' };
		}, { autoAdvance: true });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: 'b', page: null, notice: 'refresh-failed' });
		assert.equal(owner.snapshot().open, !fallback);
		assert.equal(owner.snapshot().notice, 'refresh-failed', 'durable ACK notice survives its same-generation fallback page');
		if (!fallback) assert.equal(owner.snapshot().candidateId, 'b');
	}
});

test('post-settlement page publication retires the pair while retaining the same-generation durable refresh-failed fact', async () => {
	for (const reset of ['close', 'open', 'generation']) {
		const { owner } = setup();
		assert.equal((await owner.executeCull('b', async () => ({ outcome: 'saved', photoId: 'b', page: null,
			notice: 'refresh-failed' }), { autoAdvance: true })).outcome, 'saved');
		await owner.setPage(['a', 'b', 'c', 'd'], context(page()));
		assert.equal(owner.snapshot().open, false); assert.equal(owner.snapshot().notice, 'refresh-failed');
		await owner.setPage(['a', 'c', 'd'], context(page(['a', 'c', 'd'])));
		assert.equal(owner.snapshot().notice, 'refresh-failed', 'same-generation retirement cannot erase a durable ACK fact');
		if (reset === 'close') await owner.close();
		else if (reset === 'open') owner.open(['a', 'c']);
		else await owner.setPage(['a', 'c', 'd'], context(page(['a', 'c', 'd']), 'replacement'));
		assert.equal(owner.snapshot().notice, null);
	}
});

test('late refresh-failed ACKs survive retirement without publishing notices into a closed or replacement generation', async () => {
	for (const retirement of ['close', 'generation', 'cancel']) {
		const { owner } = setup(), held = deferred<PhotoLibraryCullReceiptV1>(), entered = deferred<void>();
		const work = owner.executeCull('b', async () => { entered.resolve(); return held.promise; }, { autoAdvance: true });
		await entered.promise;
		const joining = retirement === 'close' ? owner.close() : retirement === 'cancel' ? owner.cancelAndJoin()
			: owner.setPage(['a', 'b', 'c', 'd'], context(page(), 'replacement'));
		assert.equal(await remainsPending(joining), true);
		held.resolve({ outcome: 'saved', photoId: 'b', page: null, notice: 'refresh-failed' });
		assert.equal((await work).outcome, 'saved'); await joining;
		assert.equal(owner.snapshot().notice, null);
		assert.equal(owner.snapshot().open, retirement === 'cancel');
	}
});

test('failed, busy and cancelled saves preserve the pair and Compare cannot cull a hidden subset member', async () => {
	const { owner } = setup();
	for (const outcome of ['failed', 'cancelled', 'busy'] as const) {
		assert.deepEqual(await owner.executeCull('b', async () => ({ outcome }), { autoAdvance: true }), { outcome });
		assert.equal(owner.snapshot().candidateId, 'b'); assert.equal(owner.snapshot().referenceId, 'a');
	}
	assert.deepEqual(await owner.executeCull('b', async () => { throw new Error('CAS conflict'); }, { autoAdvance: true }), { outcome: 'failed' });
	assert.throws(() => owner.executeCull('c', async () => saved(page(), 'c'), { autoAdvance: true }));
});

test('one held save admits no queued gestures and cancellation drains native work while preserving its ACK', async () => {
	const { owner, initial } = setup(), held = deferred<PhotoLibraryCullReceiptV1>(); let calls = 0;
	const work = owner.executeCull('b', async () => { calls++; return held.promise; }, { autoAdvance: true });
	await Promise.resolve();
	assert.deepEqual(await owner.executeCull('a', async () => { calls++; return saved(initial, 'a'); }, { autoAdvance: true }), { outcome: 'busy' });
	assert.throws(() => owner.open(['a', 'c'])); assert.throws(() => owner.swap());
	const cancelled = owner.cancelAndJoin(), draining = owner.drain();
	assert.equal(await remainsPending(cancelled), true); assert.equal(await remainsPending(draining), true);
	held.resolve(saved(initial)); assert.equal((await work).outcome, 'saved'); await cancelled; await draining;
	assert.equal(calls, 1); assert.equal(owner.snapshot().candidateId, 'b'); assert.equal(owner.snapshot().open, true);
});

test('strict shared culling normalization rejects hostile receipts without retaining body data or advancing', async () => {
	const { owner, initial } = setup(); let getters = 0;
	const accessor = Object.defineProperty({}, 'outcome', { enumerable: true, get() { getters++; return 'saved'; } });
	for (const invalid of [accessor, { ...saved(initial), photoId: 'foreign' }, { ...saved(initial), original: new Blob(['secret']) },
		{ ...saved(initial), page: { ...initial, rows: [{ ...initial.rows[0], original: 'bytes' }] } },
		{ ...saved(initial), page: { ...initial, rows: Array(1) } }, { ...saved(initial), notice: 'unsupported' }]) {
		await assert.rejects(owner.executeCull('b', async () => invalid as PhotoLibraryCullReceiptV1, { autoAdvance: true }));
		assert.equal(owner.snapshot().candidateId, 'b'); assert.equal(owner.snapshot().pendingPhotoId, null);
	}
	assert.equal(getters, 0);
});

test('observer exceptions and synchronous reentry cannot lose pending ownership or fabricate a save', async () => {
	const { owner, initial } = setup(); let joining: Promise<void> | undefined, calls = 0;
	owner.subscribe(snapshot => {
		if (snapshot.pendingPhotoId) { joining = owner.close(); throw new Error('Observer failed'); }
	});
	const work = owner.executeCull('b', async () => { calls++; return saved(initial); }, { autoAdvance: true });
	assert.deepEqual(await work, { outcome: 'cancelled' }); await joining;
	assert.equal(calls, 0); assert.equal(owner.snapshot().open, false);
	const { owner: clean } = setup(), seen: string[] = [];
	const listener = () => { seen.push('notified'); }, first = clean.subscribe(listener), second = clean.subscribe(listener);
	first(); const before = seen.length; clean.next(); assert.equal(seen.length, before + 1); second();
});

test('descriptor admission reentry cannot overwrite a newer closed view', () => {
	const { owner } = setup();
	const selected = new Proxy(['a', 'b'], { getOwnPropertyDescriptor(target, key) {
		if (key === '0') void owner.close(); return Reflect.getOwnPropertyDescriptor(target, key);
	} });
	assert.throws(() => owner.open(selected)); assert.equal(owner.snapshot().open, false);
});
