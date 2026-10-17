/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibrarySurveyV1 } from '../src/common/editor/controller/shared/photo-library-survey-v1.ts';
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
	const owner = new PhotoLibrarySurveyV1(), initial = page(ids);
	void owner.setPage(ids, context(initial)); owner.open(ids);
	return { owner, initial };
}

test('Survey is menu-inert and captures a frozen detached selected subset in visible order', async () => {
	const owner = new PhotoLibrarySurveyV1(), initial = page();
	assert.deepEqual(owner.snapshot(), { open: false, capturedPhotoIds: [], photoIds: [], removedPhotoIds: [],
		focusedPhotoId: null, pendingPhotoId: null, notice: null });
	await owner.setPage(['a', 'b', 'c', 'd'], context(initial)); assert.equal(owner.snapshot().open, false);
	const selected = ['d', 'a', 'c']; owner.open(selected); selected[0] = 'foreign';
	assert.deepEqual(owner.snapshot().capturedPhotoIds, ['a', 'c', 'd']); assert.deepEqual(owner.snapshot().photoIds, ['a', 'c', 'd']);
	assert.equal(owner.snapshot().focusedPhotoId, 'a');
	for (const value of [owner.snapshot(), owner.snapshot().capturedPhotoIds, owner.snapshot().photoIds, owner.snapshot().removedPhotoIds]) assert.ok(Object.isFrozen(value));
});

test('temporary removal chooses next then previous, keeps one/zero reviews open, and restores captured order without writes', () => {
	const { owner } = setup(); owner.focus('b'); owner.remove('b');
	assert.equal(owner.snapshot().focusedPhotoId, 'c'); assert.deepEqual(owner.snapshot().removedPhotoIds, ['b']);
	owner.remove('d'); assert.equal(owner.snapshot().focusedPhotoId, 'c');
	owner.remove('c'); assert.equal(owner.snapshot().focusedPhotoId, 'a');
	assert.deepEqual(owner.snapshot().photoIds, ['a']); assert.equal(owner.snapshot().open, true);
	owner.remove('a'); assert.equal(owner.snapshot().open, true); assert.equal(owner.snapshot().focusedPhotoId, null);
	assert.deepEqual(owner.snapshot().photoIds, []); assert.deepEqual(owner.snapshot().removedPhotoIds, ['a', 'b', 'c', 'd']);
	owner.next(); owner.previous(); owner.restoreRemoved();
	assert.deepEqual(owner.snapshot().photoIds, ['a', 'b', 'c', 'd']); assert.deepEqual(owner.snapshot().removedPhotoIds, []);
	assert.equal(owner.snapshot().focusedPhotoId, 'a');
});

test('focus and navigation follow current reviewed order without wrapping or restoring hidden IDs', () => {
	const { owner } = setup(); owner.previous(); assert.equal(owner.snapshot().focusedPhotoId, 'a');
	owner.remove('b'); owner.next(); assert.equal(owner.snapshot().focusedPhotoId, 'c');
	owner.next(); owner.next(); assert.equal(owner.snapshot().focusedPhotoId, 'd');
	owner.previous(); assert.equal(owner.snapshot().focusedPhotoId, 'c');
	assert.throws(() => owner.focus('b')); assert.throws(() => owner.remove('b')); assert.throws(() => owner.focus('foreign'));
	owner.restoreRemoved(); assert.equal(owner.snapshot().focusedPhotoId, 'c');
	owner.previous(); assert.equal(owner.snapshot().focusedPhotoId, 'b');
});

test('closed inert admission refuses duplicate, foreign, sparse, cyclic, getter and over-budget contexts before mutation', () => {
	const { owner, initial } = setup(); let getters = 0;
	const accessor = ['a', 'b']; Object.defineProperty(accessor, '0', { enumerable: true, get() { getters++; return 'a'; } });
	const cyclic: unknown[] = []; cyclic.push(cyclic, 'a'); const before = owner.snapshot();
	for (const ids of [[], ['a'], ['a', 'a'], ['a', 'foreign'], Array(2), accessor, cyclic,
		Array.from({ length: 65 }, (_, index) => `photo-${index}`), ['a', 'x'.repeat(257)]]) {
		assert.throws(() => owner.open(ids as string[])); assert.deepEqual(owner.snapshot(), before);
	}
	const hostile = Object.defineProperty({ generation: 'library' }, 'pageIdentity', { enumerable: true,
		get() { getters++; return initial; } });
	assert.throws(() => owner.setPage(['a', 'b'], hostile as ReturnType<typeof context>));
	assert.throws(() => owner.setPage(['a', 'b'], { ...context(initial), body: 'secret' } as ReturnType<typeof context>));
	assert.throws(() => owner.setPage(['a', 'b'], context(initial))); assert.equal(getters, 0); assert.deepEqual(owner.snapshot(), before);
});

test('opaque identities and prototype-like IDs stay inert through the full bounded review pool', async () => {
	const owner = new PhotoLibrarySurveyV1(), ids = ['__proto__', 'constructor', ...Array.from({ length: 62 }, (_, index) => `p${index}`)];
	const token = new Proxy({}, { get() { throw new Error('Opaque token traversed'); }, ownKeys() { throw new Error('Opaque token enumerated'); } });
	await owner.setPage(ids, context(token, token)); owner.open(ids);
	for (let index = 0; index < 256; index++) {
		if (index % 13 === 0) owner.restoreRemoved();
		else if (index % 5 === 0 && owner.snapshot().focusedPhotoId) owner.remove(owner.snapshot().focusedPhotoId!);
		else if (index % 2 === 0) owner.next(); else owner.previous();
		const state = owner.snapshot(); assert.equal(state.capturedPhotoIds.length, 64);
		assert.ok(state.photoIds.length + state.removedPhotoIds.length <= 64);
		assert.ok(state.photoIds.every(id => ids.includes(id) && !state.removedPhotoIds.includes(id)));
		assert.ok(state.focusedPhotoId === null || state.photoIds.includes(state.focusedPhotoId));
	}
});

test('identical context is inert while unrelated page or generation retires the captured review', async () => {
	for (const replacement of ['page', 'generation']) {
		const { owner, initial } = setup(); owner.remove('b');
		await owner.setPage(['a', 'b', 'c', 'd'], context(initial)); assert.equal(owner.snapshot().open, true);
		await owner.setPage(['a', 'b', 'c', 'd'], context(page(), replacement === 'generation' ? {} : 'library'));
		assert.equal(owner.snapshot().open, false); assert.deepEqual(owner.snapshot().capturedPhotoIds, []);
	}
});

test('saved culling keeps captured survivors and available local removals, excludes new matches, and advances by captured identity', async () => {
	const { owner } = setup(); owner.remove('c'); owner.focus('b');
	const published = page(['d', 'c', 'a', 'new']);
	assert.equal((await owner.executeCull('b', async () => saved(published), { autoAdvance: true })).outcome, 'saved');
	assert.deepEqual(owner.snapshot().capturedPhotoIds, ['a', 'b', 'c', 'd']);
	assert.deepEqual(owner.snapshot().photoIds, ['a', 'd']); assert.deepEqual(owner.snapshot().removedPhotoIds, ['c']);
	assert.equal(owner.snapshot().focusedPhotoId, 'd'); owner.restoreRemoved();
	assert.deepEqual(owner.snapshot().photoIds, ['a', 'c', 'd']); assert.equal(owner.snapshot().focusedPhotoId, 'd');
});

test('a filtered removed ID is never restored and one/zero acknowledged survivors stay reviewable', async () => {
	const { owner } = setup(); owner.remove('c'); owner.focus('b');
	await owner.executeCull('b', async () => saved(page(['a'])), { autoAdvance: false });
	assert.equal(owner.snapshot().open, true); assert.deepEqual(owner.snapshot().photoIds, ['a']);
	assert.deepEqual(owner.snapshot().removedPhotoIds, []); owner.restoreRemoved(); assert.deepEqual(owner.snapshot().photoIds, ['a']);
	await owner.executeCull('a', async () => saved(page([]), 'a'), { autoAdvance: true });
	assert.equal(owner.snapshot().open, true); assert.equal(owner.snapshot().focusedPhotoId, null);
	assert.deepEqual(owner.snapshot().photoIds, []); owner.restoreRemoved(); assert.deepEqual(owner.snapshot().photoIds, []);
});

test('a query-excluded captured photo cannot silently rejoin through a later exact own ACK', async () => {
	for (const locallyRemoved of [true, false]) {
		const { owner } = setup(); if (locallyRemoved) owner.remove('c');
		await owner.executeCull('b', async () => saved(page(['a', 'b', 'd'])), { autoAdvance: false });
		assert.deepEqual(owner.snapshot().photoIds, ['a', 'b', 'd']);
		await owner.executeCull('b', async () => saved(page()), { autoAdvance: false });
		assert.deepEqual(owner.snapshot().capturedPhotoIds, ['a', 'b', 'c', 'd']);
		assert.deepEqual(owner.snapshot().photoIds, ['a', 'b', 'd']); assert.deepEqual(owner.snapshot().removedPhotoIds, []);
		owner.restoreRemoved(); assert.deepEqual(owner.snapshot().photoIds, ['a', 'b', 'd']);
	}
});

test('auto-advance is explicit and culling another reviewed photo preserves the current focus', async () => {
	const { owner } = setup(); owner.focus('b');
	await owner.executeCull('b', async () => saved(page()), { autoAdvance: false }); assert.equal(owner.snapshot().focusedPhotoId, 'b');
	await owner.executeCull('a', async () => saved(page(), 'a'), { autoAdvance: true }); assert.equal(owner.snapshot().focusedPhotoId, 'b');
	owner.focus('d'); await owner.executeCull('d', async () => saved(page(), 'd'), { autoAdvance: true });
	assert.equal(owner.snapshot().focusedPhotoId, 'd', 'advance never wraps');
});

test('both page-before-ACK and ACK-before-layout reconcile only the exact owned receipt page', async () => {
	for (const early of [true, false]) {
		const { owner } = setup(); owner.remove('c'); owner.focus('b');
		const published = page(['d', 'a', 'c']), held = deferred<PhotoLibraryCullReceiptV1>(), entered = deferred<void>();
		const work = owner.executeCull('b', async () => { entered.resolve(); return held.promise; }, { autoAdvance: true }); await entered.promise;
		const replacement = early ? owner.setPage(['d', 'a', 'c'], context(published)) : null;
		if (replacement) { assert.equal(owner.snapshot().open, false); assert.equal(await remainsPending(replacement), true); }
		held.resolve(saved(published)); const receipt = await work; await replacement;
		assert.equal(receipt.outcome, 'saved'); await owner.setPage(['d', 'a', 'c'], context(published));
		assert.equal(owner.snapshot().open, true); assert.deepEqual(owner.snapshot().photoIds, ['a', 'd']);
		assert.deepEqual(owner.snapshot().removedPhotoIds, ['c']); assert.equal(owner.snapshot().focusedPhotoId, 'd');
	}
});

test('unrelated page/generation/Close join late native ACKs without restoring retired presentation', async () => {
	for (const replacement of ['page', 'generation', 'close']) {
		const { owner } = setup(), held = deferred<PhotoLibraryCullReceiptV1>(), entered = deferred<void>(); let signal: AbortSignal | undefined;
		const work = owner.executeCull('b', async value => { signal = value; entered.resolve(); return held.promise; }, { autoAdvance: true }); await entered.promise;
		const joining = replacement === 'close' ? owner.close()
			: owner.setPage(['a', 'c'], context(page(['a', 'c']), replacement === 'generation' ? 'replacement' : 'library'));
		assert.equal(signal?.aborted, true); assert.equal(await remainsPending(joining), true);
		held.resolve(saved(page(['a', 'c', 'd']))); assert.equal((await work).outcome, 'saved'); await joining;
		assert.equal(owner.snapshot().open, false); assert.deepEqual(owner.snapshot().photoIds, []);
	}
});

test('refresh-failed ACK retires review authority and its fact survives both fallback publication orders', async () => {
	for (const timing of ['before', 'after']) {
		const { owner } = setup();
		const receipt = await owner.executeCull('b', async () => {
			if (timing === 'before') void owner.setPage(['a', 'b', 'c', 'd'], context(page()));
			return { outcome: 'saved', photoId: 'b', page: null, notice: 'refresh-failed' };
		}, { autoAdvance: true });
		if (timing === 'after') await owner.setPage(['a', 'b', 'c', 'd'], context(page()));
		assert.equal(receipt.outcome, 'saved'); assert.equal(owner.snapshot().open, false);
		assert.equal(owner.snapshot().notice, 'refresh-failed'); assert.deepEqual(owner.snapshot().photoIds, []);
		await owner.setPage(['a', 'c'], context(page(['a', 'c']))); assert.equal(owner.snapshot().notice, 'refresh-failed');
		await owner.close(); assert.equal(owner.snapshot().notice, null);
	}
});

test('explicit cancellation/generation replacement suppress late refresh notices but cannot revoke durable receipts', async () => {
	for (const retirement of ['cancel', 'generation', 'close']) {
		const { owner } = setup(), held = deferred<PhotoLibraryCullReceiptV1>(), entered = deferred<void>();
		const work = owner.executeCull('b', async () => { entered.resolve(); return held.promise; }, { autoAdvance: true }); await entered.promise;
		const joining = retirement === 'close' ? owner.close() : retirement === 'cancel' ? owner.cancelAndJoin()
			: owner.setPage(['a', 'b', 'c', 'd'], context(page(), 'replacement'));
		held.resolve({ outcome: 'saved', photoId: 'b', page: null, notice: 'refresh-failed' });
		assert.equal((await work).outcome, 'saved'); await joining; assert.equal(owner.snapshot().notice, null);
	}
});

test('a published identity/ID conflict retires the view while retaining its valid saved ACK', async () => {
	const { owner } = setup(), published = page(['a', 'c', 'd']);
	const receipt = await owner.executeCull('b', async () => { void owner.setPage(['a', 'b'], context(published)); return saved(published); }, { autoAdvance: true });
	assert.equal(receipt.outcome, 'saved'); assert.equal(owner.snapshot().open, false); assert.equal(owner.snapshot().notice, null);
});

test('one held cull has no queued writes; review edits refuse until cancellation/drain joins its native ACK', async () => {
	const { owner, initial } = setup(), held = deferred<PhotoLibraryCullReceiptV1>(), entered = deferred<void>(); let calls = 0;
	owner.focus('b');
	const work = owner.executeCull('b', async () => { calls++; entered.resolve(); return held.promise; }, { autoAdvance: true }); await entered.promise;
	assert.deepEqual(await owner.executeCull('a', async () => { calls++; return saved(initial, 'a'); }, { autoAdvance: false }), { outcome: 'busy' });
	for (const edit of [() => owner.focus('a'), () => owner.next(), () => owner.previous(), () => owner.remove('a'),
		() => owner.restoreRemoved(), () => owner.open(['a', 'c'])]) assert.throws(edit);
	const joining = owner.cancelAndJoin(), draining = owner.drain();
	assert.equal(await remainsPending(joining), true); assert.equal(await remainsPending(draining), true);
	assert.throws(() => owner.open(['a', 'c'])); held.resolve(saved(initial)); assert.equal((await work).outcome, 'saved');
	await joining; await draining; assert.equal(calls, 1); assert.equal(owner.snapshot().focusedPhotoId, 'b');
});

test('unsaved outcomes and thrown save failures retain temporary review state without advancing', async () => {
	const { owner } = setup(); owner.remove('c'); owner.focus('b');
	for (const outcome of ['failed', 'cancelled', 'busy'] as const) {
		assert.deepEqual(await owner.executeCull('b', async () => ({ outcome }), { autoAdvance: true }), { outcome });
		assert.equal(owner.snapshot().focusedPhotoId, 'b'); assert.deepEqual(owner.snapshot().removedPhotoIds, ['c']);
	}
	assert.deepEqual(await owner.executeCull('b', async () => { throw new Error('CAS conflict'); }, { autoAdvance: true }), { outcome: 'failed' });
	assert.throws(() => owner.executeCull('c', async () => saved(page(), 'c'), { autoAdvance: true }));
});

test('shared strict receipt admission rejects getter/body/sparse/foreign outputs without corrupting review', async () => {
	const { owner, initial } = setup(); let getters = 0;
	const accessor = Object.defineProperty({}, 'outcome', { enumerable: true, get() { getters++; return 'saved'; } });
	for (const invalid of [accessor, { ...saved(initial), photoId: 'foreign' }, { ...saved(initial), original: new Blob(['secret']) },
		{ ...saved(initial), page: { ...initial, rows: Array(1) } }, { ...saved(initial), notice: 'unknown' }]) {
		await assert.rejects(owner.executeCull('b', async () => invalid as PhotoLibraryCullReceiptV1, { autoAdvance: true }));
		assert.equal(owner.snapshot().pendingPhotoId, null); assert.equal(owner.snapshot().focusedPhotoId, 'a');
	}
	assert.equal(getters, 0);
});

test('observer exceptions and Close reentry cannot lose pending ownership or start a cancelled borrowed save', async () => {
	const { owner, initial } = setup(); let joining: Promise<void> | undefined, calls = 0;
	owner.subscribe(state => { if (state.pendingPhotoId) { joining = owner.close(); throw new Error('Observer failed'); } });
	assert.deepEqual(await owner.executeCull('b', async () => { calls++; return saved(initial); }, { autoAdvance: true }), { outcome: 'cancelled' });
	await joining; assert.equal(calls, 0); assert.equal(owner.snapshot().open, false);
	const { owner: other } = setup(); const seen: number[] = [], listener = () => { seen.push(1); };
	const first = other.subscribe(listener), second = other.subscribe(listener); first(); const before = seen.length;
	other.next(); assert.equal(seen.length, before + 1); second();
});

test('a page replaced by a pending observer cancels before the borrowed save starts', async () => {
	for (const containsTarget of [true, false]) {
		const { owner, initial } = setup(); let calls = 0, replaced = false, joining: Promise<void> | undefined;
		owner.subscribe(state => { if (state.pendingPhotoId && !replaced) {
			replaced = true; const ids = containsTarget ? ['a', 'b', 'c'] : ['a', 'c'];
			joining = owner.setPage(ids, context(page(ids)));
		} });
		assert.deepEqual(await owner.executeCull('b', async () => { calls++; return saved(initial); }, { autoAdvance: true }), { outcome: 'cancelled' });
		await joining; assert.equal(calls, 0); assert.equal(owner.snapshot().open, false);
	}
});

test('admission reentry cannot overwrite a newer closed review and observers are bounded', () => {
	const { owner } = setup();
	const selected = new Proxy(['a', 'b'], { getOwnPropertyDescriptor(target, key) {
		if (key === '0') void owner.close(); return Reflect.getOwnPropertyDescriptor(target, key);
	} });
	assert.throws(() => owner.open(selected)); assert.equal(owner.snapshot().open, false);
	const removals = Array.from({ length: 64 }, () => owner.subscribe(() => undefined));
	assert.throws(() => owner.subscribe(() => undefined)); for (const remove of removals) remove();
	assert.doesNotThrow(() => owner.subscribe(() => undefined)());
});

test('observer review reentry notifies remaining subscribers of the final current snapshot', () => {
	const { owner } = setup(); let removed = false;
	owner.subscribe(state => { if (!removed && state.focusedPhotoId === 'b') { removed = true; owner.remove('b'); } });
	const observed: string[] = []; owner.subscribe(state => { observed.push(state.focusedPhotoId ?? 'empty'); });
	owner.focus('b'); assert.equal(owner.snapshot().focusedPhotoId, 'c');
	assert.equal(observed.at(-1), 'c', 'a state-changing observer cannot hide the latest scalar publication');
});

test('a continuously reentering observer cannot create an unbounded notification loop', () => {
	const { owner } = setup(); let armed = false, calls = 0;
	owner.subscribe(state => { calls++; if (armed) owner.focus(state.focusedPhotoId === 'a' ? 'b' : 'a'); });
	armed = true; owner.focus('b'); assert.equal(calls, 65);
	assert.ok(owner.snapshot().photoIds.includes(owner.snapshot().focusedPhotoId!));
	assert.equal(owner.snapshot().pendingPhotoId, null);
});

test('a final observer may register the next cull without the prior settlement clearing its ownership', async () => {
	const { owner } = setup(), held = deferred<PhotoLibraryCullReceiptV1>(), entered = deferred<void>(); owner.focus('b');
	let next: Promise<PhotoLibraryCullReceiptV1> | undefined, requested = false;
	owner.subscribe(state => { if (!requested && state.pendingPhotoId === null && state.focusedPhotoId === 'c') {
		requested = true; next = owner.executeCull('c', async () => { entered.resolve(); return held.promise; }, { autoAdvance: false });
	} });
	assert.equal((await owner.executeCull('b', async () => saved(page()), { autoAdvance: true })).outcome, 'saved'); await entered.promise;
	assert.equal(owner.snapshot().pendingPhotoId, 'c'); assert.equal(await remainsPending(owner.drain()), true);
	assert.deepEqual(await owner.executeCull('a', async () => saved(page(), 'a'), { autoAdvance: false }), { outcome: 'busy' });
	assert.ok(next); held.resolve(saved(page(), 'c')); assert.equal((await next).outcome, 'saved'); await owner.drain();
});
