/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	snapshotFramescaperProjectCommandV20,
} from '../src/framescaper/editor-project-v20-commands.ts';

test('V20 snapshots expected and replacement keyframe wires under independent structural budgets', () => {
	const largeWire = {
		schemaVersion: 1,
		timeDomain: {},
		curves: Array.from({ length: 99_996 }, () => 0),
	};
	const snapshot = snapshotFramescaperProjectCommandV20({
		type: 'video-keyframes/set',
		clipId: 'video-clip',
		expectedKeyframes: largeWire,
		keyframes: largeWire,
	});
	assert.equal(snapshot.type, 'video-keyframes/set');
	assert.equal(Object.isFrozen(snapshot), true);
	assert.notStrictEqual(snapshot.expectedKeyframes, snapshot.keyframes);
	assert.equal((snapshot.expectedKeyframes.curves as readonly unknown[]).length, 99_996);
});

test('V20 applies one inert aggregate command budget across independently admitted wires', () => {
	const largeWire = {
		schemaVersion: 1,
		timeDomain: {},
		curves: Array.from({ length: 60_000 }, () => 0),
	};
	const child = () => ({
		type: 'video-keyframes/set',
		clipId: 'video-clip',
		expectedKeyframes: largeWire,
		keyframes: largeWire,
	});
	assert.throws(
		() => snapshotFramescaperProjectCommandV20({
			type: 'batch', commands: [child(), child(), child(), child()],
		}),
		/aggregate structural node limit/iu,
	);

	let calls = 0;
	const accessor: Record<string, unknown> = { type: 'batch' };
	Object.defineProperty(accessor, 'commands', {
		enumerable: true,
		get: () => { calls += 1; return []; },
	});
	assert.throws(
		() => snapshotFramescaperProjectCommandV20(accessor),
		/enumerable data propert/iu,
	);
	const toJson = {
		type: 'project/rename',
		title: 'Inert',
		toJSON: () => { calls += 1; return {}; },
	};
	assert.throws(
		() => snapshotFramescaperProjectCommandV20(toJson),
		/JSON-compatible|toJSON/iu,
	);
	assert.equal(calls, 0);
});

test('V20 snapshot admission bounds nested command batches', () => {
	const cycle: Record<string, unknown> = { type: 'batch', commands: [] };
	(cycle.commands as unknown[]).push(cycle);
	assert.throws(
		() => snapshotFramescaperProjectCommandV20(cycle),
		/cyclic.*batch/iu,
	);
	let nested: Record<string, unknown> = { type: 'project/rename', title: 'Leaf' };
	for (let index = 0; index < 130; index += 1) {
		nested = { type: 'batch', commands: [nested] };
	}
	assert.throws(
		() => snapshotFramescaperProjectCommandV20(nested),
		/nesting depth/iu,
	);
});

test('V20 shares one execution-boundary cap across keyframe sets and fresh creators', () => {
	const wire = { schemaVersion: 1, timeDomain: {}, curves: [] };
	const set = {
		type: 'video-keyframes/set', clipId: 'video-clip',
		expectedKeyframes: wire, keyframes: wire,
	};
	const add = (index: number) => ({
		type: 'clip/add', trackId: 'video-track',
		clip: { kind: 'video', id: `fresh-${String(index)}` },
	});
	assert.throws(
		() => snapshotFramescaperProjectCommandV20({
			type: 'batch', commands: Array.from({ length: 129 }, () => set),
		}),
		/ordered execution boundary limit/iu,
	);
	assert.throws(
		() => snapshotFramescaperProjectCommandV20({
			type: 'batch', commands: Array.from({ length: 129 }, (_, index) => add(index)),
		}),
		/ordered execution boundary limit/iu,
	);
	assert.throws(
		() => snapshotFramescaperProjectCommandV20({
			type: 'batch', commands: [
				...Array.from({ length: 64 }, () => set),
				...Array.from({ length: 65 }, (_, index) => add(index)),
			],
		}),
		/ordered execution boundary limit/iu,
	);
});
