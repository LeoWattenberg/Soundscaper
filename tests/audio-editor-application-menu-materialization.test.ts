/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { materializeApplicationMenu } from '../src/common/editor/ui/application-menu-materialization.ts';

test('menu materialization resolves frozen leaves independently without mutating input', () => {
	const calls: string[] = [];
	const input = Object.freeze({
		id: 'edit',
		label: 'Edit',
		items: Object.freeze([
			Object.freeze({
				id: 'refused',
				label: 'Refused',
				disabled: false,
				resolve: () => {
					calls.push('refused');
					throw new Error('planner refusal');
				},
			}),
			Object.freeze({
				id: 'enabled',
				label: 'Enabled',
				disabled: true,
				resolve: () => {
					calls.push('enabled');
					return Object.freeze({ disabled: false });
				},
			}),
		]),
	});

	const materialized = materializeApplicationMenu(input);

	assert.deepEqual(calls, ['refused', 'enabled']);
	assert.notEqual(materialized, input);
	assert.deepEqual(materialized.items?.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'refused', disabled: true },
		{ id: 'enabled', disabled: false },
	]);
	assert.ok(materialized.items?.every((item) => !Object.hasOwn(item, 'resolve')));
	assert.equal(typeof input.items[0].resolve, 'function');
	assert.equal(input.items[0].disabled, false);
	assert.ok(Object.isFrozen(materialized));
	assert.ok(Object.isFrozen(materialized.items));
	assert.ok(materialized.items?.every(Object.isFrozen));
});

test('invalid leaf resolution fails closed without hiding its siblings', () => {
	const inaccessibleResolver = Object.defineProperty({ id: 'inaccessible', disabled: false }, 'resolve', {
		enumerable: true,
		get: () => { throw new Error('resolver accessor refusal'); },
	});
	const input = {
		id: 'edit',
		items: [
			{ id: 'invalid', disabled: false, resolve: () => ({ disabled: 'no' }) },
			inaccessibleResolver,
			{ id: 'sibling', disabled: false, resolve: () => ({ disabled: false }) },
		],
	};

	const materialized = materializeApplicationMenu(input);

	assert.deepEqual(materialized.items?.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'invalid', disabled: true },
		{ id: 'inaccessible', disabled: true },
		{ id: 'sibling', disabled: false },
	]);
});
