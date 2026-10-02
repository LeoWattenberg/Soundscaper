/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sameProjectSnapshot } from '../src/common/editor/storage/project-snapshot-equality.ts';

test('large project arrays do not repeatedly search a linear list of keys', () => {
	const clips = Array.from({ length: 5_000 }, (_, index) => ({ id: `clip-${String(index)}`, frame: index }));
	const detached = structuredClone(clips);
	const nativeIncludes = Array.prototype.includes;
	let largeKeyListSearches = 0;
	Array.prototype.includes = function (this: unknown[], value: unknown, fromIndex?: number): boolean {
		if (this.length >= clips.length) largeKeyListSearches += 1;
		return nativeIncludes.call(this, value, fromIndex);
	};
	try {
		assert.equal(sameProjectSnapshot(clips, detached), true);
		assert.equal(largeKeyListSearches, 0);
	} finally { Array.prototype.includes = nativeIncludes; }
});

test('snapshot equality preserves array order, sparse holes, symbols, and nonenumerable keys', () => {
	assert.equal(sameProjectSnapshot([1, 2], [2, 1]), false);
	assert.equal(sameProjectSnapshot(new Array<unknown>(2), [undefined, undefined]), false);
	const sparse = new Array<number>(2);
	sparse[1] = 2;
	assert.equal(sameProjectSnapshot(sparse, structuredClone(sparse)), true);
	const symbol = Symbol('project-extension');
	const left = Object.defineProperty({ [symbol]: { extension: 1 } }, 'hidden', { value: 2 });
	const right = Object.defineProperty({ [symbol]: { extension: 1 } }, 'hidden', { value: 2 });
	assert.equal(sameProjectSnapshot(left, right), true);
	assert.equal(sameProjectSnapshot(left, { [symbol]: { extension: 1 }, hidden: 2 }), false);
	assert.equal(sameProjectSnapshot(left, Object.defineProperty({ [Symbol('project-extension')]: { extension: 1 } },
		'hidden', { value: 2 })), false);
	assert.equal(sameProjectSnapshot(left, Object.defineProperty({ [symbol]: { extension: 2 } }, 'hidden', { value: 2 })), false);
});

test('snapshot equality handles cycles, binary values and dates without reading accessors', () => {
	const left: { self?: object; buffer: Uint8Array; date: Date } = { buffer: new Uint8Array([1, 2]), date: new Date(0) };
	const right: { self?: object; buffer: Uint8Array; date: Date } = { buffer: new Uint8Array([1, 2]), date: new Date(0) };
	left.self = left;
	right.self = right;
	assert.equal(sameProjectSnapshot(left, right), true);
	right.buffer[1] = 3;
	assert.equal(sameProjectSnapshot(left, right), false);
	let accessorReads = 0;
	const accessor = { get field() { accessorReads += 1; return 1; } };
	assert.equal(sameProjectSnapshot(accessor, { field: 1 }), false);
	assert.equal(accessorReads, 0);
});

test('project snapshot equality ignores whether equal nested values share an object', () => {
	const shared = { gain: 1, mute: false };
	const withSharedState = {
		tracks: [{ id: 'left', state: shared }, { id: 'right', state: shared }],
	};
	const withSeparateState = {
		tracks: [
			{ id: 'left', state: { gain: 1, mute: false } },
			{ id: 'right', state: { gain: 1, mute: false } },
		],
	};

	assert.equal(sameProjectSnapshot(withSharedState, withSeparateState), true);
	assert.equal(sameProjectSnapshot(withSeparateState, withSharedState), true);
	assert.equal(sameProjectSnapshot(withSharedState, {
		tracks: [
			{ id: 'left', state: { gain: 1, mute: false } },
			{ id: 'right', state: { gain: 0.5, mute: false } },
		],
	}), false);
});
