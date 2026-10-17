/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibrarySelectionV1 } from '../src/common/editor/controller/shared/photo-library-selection-v1.ts';

const context = (pageIdentity: unknown = {}, generation: unknown = 'library') => ({ generation, pageIdentity });

test('a detached bounded page preserves separate focus, primary, selection and anchor', () => {
	const owner = new PhotoLibrarySelectionV1(), ids = ['a', 'b', 'c', 'd'];
	owner.setPage(ids, context()); ids[0] = 'mutated';
	owner.select('a'); owner.select('c', { toggle: true }); owner.focus('b');
	assert.deepEqual(owner.snapshot(), { photoIds: ['a', 'b', 'c', 'd'], selectedIds: ['a', 'c'], focusedId: 'b', primaryId: 'c', anchorId: 'c' });
	assert.ok(Object.isFrozen(owner.snapshot())); assert.ok(Object.isFrozen(owner.snapshot().selectedIds));
	owner.select('c', { toggle: true });
	assert.deepEqual(owner.snapshot().selectedIds, ['a']); assert.equal(owner.snapshot().primaryId, 'a');
});

test('range navigation remains page-local and toggle navigation preserves the selected subset', () => {
	const owner = new PhotoLibrarySelectionV1(); owner.setPage(['a', 'b', 'c', 'd'], context());
	owner.select('b'); owner.navigate('b', 'End', { range: true });
	assert.deepEqual(owner.snapshot().selectedIds, ['b', 'c', 'd']); assert.equal(owner.snapshot().anchorId, 'b');
	owner.navigate('d', 'Home', { toggle: true });
	assert.equal(owner.snapshot().focusedId, 'a'); assert.deepEqual(owner.snapshot().selectedIds, ['b', 'c', 'd']);
	owner.navigate('a', 'ArrowRight'); assert.deepEqual(owner.snapshot().selectedIds, ['b']);
	owner.selectAll(); assert.equal(owner.snapshot().selectedIds.length, 4);
	owner.clear(); assert.deepEqual(owner.snapshot().selectedIds, []); assert.equal(owner.snapshot().focusedId, 'b');
	assert.equal(owner.navigate('b', 'Enter'), null);
});

test('page changes intersect selection and a new generation clears every selected identity', () => {
	const owner = new PhotoLibrarySelectionV1(); owner.setPage(['a', 'b', 'c'], context());
	owner.select('a'); owner.select('c', { toggle: true }); owner.focus('b');
	owner.setPage(['c', 'd'], context());
	assert.deepEqual(owner.snapshot().selectedIds, ['c']); assert.equal(owner.snapshot().focusedId, null);
	assert.equal(owner.snapshot().primaryId, 'c');
	owner.setPage(['c', 'd'], context({}, 'other-library'));
	assert.deepEqual(owner.snapshot().selectedIds, []); assert.equal(owner.snapshot().primaryId, null);
});

test('inert page admission rejects sparse, accessor, duplicate, excessive, cyclic and unsupported IDs before publication', () => {
	const owner = new PhotoLibrarySelectionV1(); owner.setPage(['stable'], context());
	let calls = 0; const accessor = ['a']; Object.defineProperty(accessor, '0', { enumerable: true, get() { calls++; return 'a'; } });
	const cyclic: unknown[] = []; cyclic.push(cyclic);
	for (const invalid of [Array(1), accessor, ['a', 'a'], Array.from({ length: 65 }, (_, i) => `id${i}`), cyclic, [''], ['a\n'], ['x'.repeat(257)]]) {
		assert.throws(() => owner.setPage(invalid as string[], context()));
		assert.deepEqual(owner.snapshot().photoIds, ['stable']);
	}
	assert.equal(calls, 0); assert.throws(() => owner.select('foreign'));
});

test('opaque context tokens are compared without traversing and observers may unsubscribe reentrantly', () => {
	const owner = new PhotoLibrarySelectionV1(); let calls = 0;
	const opaque = Object.defineProperty({}, 'danger', { get() { throw new Error('opaque token traversed'); } });
	owner.setPage(['a'], context(opaque, opaque));
	const unsubscribe = owner.subscribe(() => { calls++; });
	owner.select('a'); unsubscribe(); owner.clear(); assert.equal(calls, 2);
	const captured = owner.capture(); owner.focus('a'); assert.equal(owner.isCurrent(captured), true);
	owner.select('a'); assert.equal(owner.isCurrent(captured), false, 'explicit reselection fences an older receipt');
});

test('bounded selection operations remain subsets under deterministic adversarial navigation sequences', () => {
	const owner = new PhotoLibrarySelectionV1(), ids = Array.from({ length: 64 }, (_, index) => `photo-${index}`);
	owner.setPage(ids, context());
	for (let index = 0; index < 512; index++) {
		const id = ids[(index * 37) % ids.length]!;
		owner.select(id, { toggle: index % 3 === 0, range: index % 5 === 0 });
		owner.navigate(id, index % 2 ? 'Home' : 'End', { toggle: index % 7 === 0, range: index % 11 === 0 });
		const current = owner.snapshot();
		assert.equal(new Set(current.selectedIds).size, current.selectedIds.length);
		assert.ok(current.selectedIds.every(value => ids.includes(value)));
		assert.ok(current.selectedIds.length <= 64);
		assert.ok(current.primaryId === null || current.selectedIds.includes(current.primaryId));
	}
});
