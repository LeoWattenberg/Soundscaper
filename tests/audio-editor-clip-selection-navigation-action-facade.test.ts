/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createGroupedEditorActions,
	type EditorActionRuntime,
} from '../src/common/editor/controller/composition/action-facade.ts';
import { createEditorSelectionActionGroup } from '../src/common/editor/controller/composition/selection-action-group.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';

const ACTIONS = Object.freeze([
	'selectPreviousClipBoundaryToCursor',
	'selectCursorToNextClipBoundary',
	'selectPreviousClip',
	'selectNextClip',
	'skipToSelectionStart',
	'skipToSelectionEnd',
	'selectNoTracks',
] as const);

test('controller timeline facade exposes every clip-selection navigation action', () => {
	const calls: string[] = [];
	let ambientProductReads = 0;
	const clipNavigation = Object.freeze(Object.fromEntries(ACTIONS.map((name) => [
		name,
		() => { calls.push(name); return name; },
	])));
	const base = createActionFacadeRuntime();
	const selection = createEditorSelectionActionGroup({
		getSelectionView: () => new Proxy({ clipNavigation }, {
			get(target, name, receiver) {
				return name === 'clipNavigation'
					? clipNavigation
					: Reflect.get(target, name, receiver) ?? (() => undefined);
			},
		}) as never,
	});
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'productSequenceActions') {
				ambientProductReads += 1;
				return { ambientSequenceAction: () => undefined };
			}
			if (name === 'selection') return selection;
			return Reflect.get(target, name, receiver);
		},
	}) satisfies EditorActionRuntime;

	const timeline = createGroupedEditorActions(runtime).timeline;
	for (const name of ACTIONS) {
		const action = timeline[name];
		assert.equal(typeof action, 'function', name);
		if (typeof action !== 'function') throw new TypeError(`Missing timeline action: ${name}.`);
		assert.equal(action(), name);
	}
	assert.deepEqual(calls, ACTIONS);
	assert.equal(ambientProductReads, 0);
	assert.equal(Object.hasOwn(createGroupedEditorActions(runtime).sequences, 'ambientSequenceAction'), false);
	assert.equal(Object.isFrozen(timeline), true);
});
