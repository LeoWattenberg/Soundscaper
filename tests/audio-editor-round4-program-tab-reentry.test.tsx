/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import MacroScriptEditor from '../src/common/editor/ui/inspector/MacroScriptEditor.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Program Tab escape belongs to the current focus session', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const source = () => dom.one('textarea');
	const press = async (key: string) => {
		let prevented = false;
		const field = source();
		await act(async () => reactProps(field).onKeyDown({ key,
			currentTarget: { value: field.value, selectionStart: field.value.length, selectionEnd: field.value.length },
			preventDefault() { prevented = true; }, stopPropagation() {},
		}));
		return prevented;
	};
	function Editor() {
		const [script, setScript] = useState({ id: 'authored', name: 'Program', source: 'code' });
		return <MacroScriptEditor script={script} onChange={setScript} log={[]} failure={null}
			copy={{ programName: 'Program name', program: 'Program', tabHint: 'Escape then Tab',
				sandboxNotice: 'Program', runProgram: 'Run' }} running={false} blocked={false}
			onRun={() => {}} onCancel={() => {}} onTrust={() => {}} />;
	}
	try {
		await act(async () => root.render(<Editor />));
		assert.equal(await press('Escape'), true);
		assert.equal(await press('Tab'), false, 'Escape then Tab still permits native focus navigation');
		await press('Escape');
		await act(async () => reactProps(source()).onBlur?.());
		assert.equal(await press('Tab'), true, 'mouse departure clears the previous escape request');
		assert.equal(source().value, 'code  ');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
