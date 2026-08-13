/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNestedSequenceMenuItems,
} from '../src/common/editor/ui/framescaper-nested-sequence-menu.ts';

const COPY = Object.freeze({
	nestedSequences: 'Nested sequences',
	addNestedSequence: 'Add shared sequence',
	updateNestedSequence: 'Move nested sequence',
	removeNestedSequence: 'Remove nested sequence',
});

test('Framescaper exposes opt-in add, update, and remove leaves with exact commands', () => {
	const calls: unknown[] = [];
	const items = createFramescaperNestedSequenceMenuItems({
		productId: 'framescaper', project: project(), editingBlocked: false, copy: COPY,
	}, { execute: (command) => calls.push(command) });
	assert.equal(items.id, 'nested-sequences');
	assert.equal(items.label, 'Nested sequences');
	assert.deepEqual(items.items.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'nested-sequence-add', disabled: false },
		{ id: 'nested-sequence-update', disabled: false },
		{ id: 'nested-sequence-remove', disabled: false },
	]);
	for (const item of items.items) item.onClick();
	assert.deepEqual(calls, [
		{
			type: 'subsequence/add',
			subsequence: {
				id: 'nested-main-shared-1', sequenceId: 'main', sourceSequenceId: 'shared',
				sequenceStartFrame: 0, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 24,
			},
		},
		{
			type: 'subsequence/update', subsequenceId: 'nested-existing',
			changes: { sequenceStartFrame: 60 },
		},
		{ type: 'subsequence/remove', subsequenceId: 'nested-existing' },
	]);
	assert.equal(Object.isFrozen(items), true);
	assert.equal(Object.isFrozen(items.items), true);
});

test('Soundscaper has no nested-sequence menu and blocked or incomplete state stays inert', () => {
	const calls: unknown[] = [];
	assert.equal(createFramescaperNestedSequenceMenuItems({
		productId: 'soundscaper', project: project(), editingBlocked: false, copy: COPY,
	}, { execute: (command) => calls.push(command) }), null);
	for (const [name, value] of [
		['blocked', { ...project(), editingBlocked: true }],
		['one sequence', {
			...project(), sequences: [{ id: 'main', rate: { num: 30, den: 1 } }], subsequences: [],
		}],
		['malformed', {}],
	] as const) {
		const items = createFramescaperNestedSequenceMenuItems({
			productId: 'framescaper', project: value, editingBlocked: name === 'blocked', copy: COPY,
		}, { execute: (command) => calls.push(command) });
		assert.ok(items, name);
		assert.equal(items.items.every(({ disabled }) => disabled), true, name);
		for (const item of items.items) item.onClick();
	}
	assert.deepEqual(calls, []);
});

function project(): Record<string, unknown> {
	return {
		id: 'nested-menu', schemaVersion: 18, primarySequenceId: 'main',
		sequences: [
			{ id: 'main', rate: { num: 30, den: 1 } },
			{ id: 'shared', rate: { num: 24, den: 1 } },
		],
		subsequences: [{
			id: 'nested-existing', sequenceId: 'main', sourceSequenceId: 'shared',
			sequenceStartFrame: 30, sequenceFrameCount: 30,
			sourceInFrame: 0, sourceFrameCount: 24,
		}],
	};
}
