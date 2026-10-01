/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	EDITOR_ACTION_FUNCTION_NAMES,
	assertEditorActionRuntime,
	type EditorActionRuntime,
} from '../src/common/editor/controller/composition/action-facade-runtime.ts';
import type { EditorActionFunctions } from '../src/common/editor/controller/composition/editor-action-functions.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';

type AssertTrue<Value extends true> = Value;

export type EditorActionFunctionInventoryIsExhaustive = AssertTrue<
	Exclude<keyof EditorActionFunctions, typeof EDITOR_ACTION_FUNCTION_NAMES[number]> extends never
		? true
		: false
>;

test('a missing or non-callable dependency fails during assembly with its name', () => {
	assert.equal(EDITOR_ACTION_FUNCTION_NAMES.length, 210);
	for (const invalid of [undefined, null, 1, {}]) {
		const scope = new Proxy(createActionFacadeRuntime(), {
			get(target, name, receiver) {
				return name === 'saveNow' ? invalid : Reflect.get(target, name, receiver);
			},
		});
		assert.throws(() => assertEditorActionRuntime(scope), /Missing editor action dependency: saveNow/u);
	}
	assert.doesNotThrow(() => assertEditorActionRuntime(createActionFacadeRuntime()));
});

test('a missing or non-callable grouped CUE import dependency fails with its exact path', () => {
	for (const invalid of [undefined, null, 1, {}]) {
		const runtime = createActionFacadeRuntime();
		const scope = new Proxy(runtime, {
			get(target, name, receiver) {
				return name === 'labels'
					? Object.freeze({ ...target.labels, importCueFile: invalid })
					: Reflect.get(target, name, receiver);
			},
		});
		assert.throws(
			() => assertEditorActionRuntime(scope),
			/Missing editor action dependency: labels\.importCueFile/u,
		);
	}
});

test('action assembly rejects an unowned label group even when its visible shape matches', () => {
	const runtime = createActionFacadeRuntime();
	const scope = new Proxy(runtime, {
		get(target, name, receiver) {
			return name === 'labels' ? Object.freeze({ ...target.labels }) : Reflect.get(target, name, receiver);
		},
	});
	assert.throws(() => assertEditorActionRuntime(scope), /Invalid editor action dependency: labels/u);
});

test('a missing or non-callable grouped exact-selection dependency fails with its exact path', () => {
	for (const invalid of [undefined, null, 1, {}]) {
		const runtime = createActionFacadeRuntime();
		const scope = new Proxy(runtime, {
			get(target, name, receiver) {
				return name === 'selection'
					? Object.freeze({ ...target.selection, setExactSelection: invalid })
					: Reflect.get(target, name, receiver);
			},
		});
		assert.throws(
			() => assertEditorActionRuntime(scope),
			/Missing editor action dependency: selection\.setExactSelection/u,
		);
	}
});

test('action assembly rejects an unowned selection group even when its visible shape matches', () => {
	const runtime = createActionFacadeRuntime();
	const scope = new Proxy(runtime, {
		get(target, name, receiver) {
			return name === 'selection' ? Object.freeze({ ...target.selection }) : Reflect.get(target, name, receiver);
		},
	});
	assert.throws(() => assertEditorActionRuntime(scope), /Invalid editor action dependency: selection/u);
});

test('a missing grouped Project Bin visual dependency fails with its exact path', () => {
	const runtime = createActionFacadeRuntime();
	const scope = new Proxy(runtime, {
		get(target, name, receiver) {
			return name === 'projectBin'
				? Object.freeze({ ...target.projectBin, getVisualData: null })
				: Reflect.get(target, name, receiver);
		},
	});
	assert.throws(
		() => assertEditorActionRuntime(scope),
		/Missing editor action dependency: projectBin\.getVisualData/u,
	);
});

test('action assembly rejects an unowned Project Bin group even when its visible shape matches', () => {
	const runtime = createActionFacadeRuntime();
	const scope = new Proxy(runtime, {
		get(target, name, receiver) {
			return name === 'projectBin'
				? Object.freeze({ ...target.projectBin })
				: Reflect.get(target, name, receiver);
		},
	});
	assert.throws(() => assertEditorActionRuntime(scope), /Invalid editor action dependency: projectBin/u);
});

// The dependency inventory must remain closed even while some legacy command
// payloads still need narrowing. An arbitrary index signature would make this
// directive fail the test typecheck by accepting the misspelled port.
// @ts-expect-error There is no arbitrary-name fallback in the action assembly.
export type MisspelledActionDependency = EditorActionRuntime['saveNwo'];
