/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectBinNameEditor from '../src/common/editor/ui/workspace/ProjectBinNameEditor.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape'] as const) test(`bin rename releases ${key} while native text composition is active`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const committed: string[] = [];
	try {
		await act(async () => { root.render(<ProjectBinNameEditor clip={{ id: 'clip' }} name="Recording"
			copy={{ projectBinRename: 'Rename recording' }} disabled={false} onCommit={name => { committed.push(name); }} />); });
		const input = dom.one('input');
		input.focus();
		Object.defineProperty(input, 'blur', { configurable: true, value: () => {
			input.ownerDocument.activeElement = input.ownerDocument.body;
			reactProps(input).onBlur();
		} });
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: 'とう' } }); });
		let consumed = false;
		await act(async () => { reactProps(input).onKeyDown({ key, currentTarget: input,
			nativeEvent: { isComposing: true }, preventDefault: () => { consumed = true; },
			stopPropagation: () => { consumed = true; } }); });
		assert.equal(input.ownerDocument.activeElement, input, 'the IME retains its editing target');
		assert.equal(input.value, 'とう');
		assert.equal(consumed, false);
		assert.deepEqual(committed, []);
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: '東京の録音' } }); });
		await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', currentTarget: input,
			nativeEvent: { isComposing: false } }); });
		assert.deepEqual(committed, ['東京の録音'], 'ordinary completed Enter retains name publication');
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
