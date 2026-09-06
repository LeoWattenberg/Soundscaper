/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertEditorActionFunctions,
	type EditorActionRuntime,
} from '../src/common/editor/controller/action-facade-runtime.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';

test('a missing or non-callable dependency fails during assembly with its name', () => {
	for (const invalid of [undefined, null, 1, {}]) {
		const scope = new Proxy(createActionFacadeRuntime(), {
			get(target, name, receiver) {
				return name === 'saveNow' ? invalid : Reflect.get(target, name, receiver);
			},
		});
		assert.throws(() => assertEditorActionFunctions(scope), /Missing editor action dependency: saveNow/u);
	}
	assert.doesNotThrow(() => assertEditorActionFunctions(createActionFacadeRuntime()));
});

// The dependency inventory must remain closed even while some legacy command
// payloads still need narrowing. An arbitrary index signature would make this
// directive fail the test typecheck by accepting the misspelled port.
// @ts-expect-error There is no arbitrary-name fallback in the action assembly.
export type MisspelledActionDependency = EditorActionRuntime['saveNwo'];
