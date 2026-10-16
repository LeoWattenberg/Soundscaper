/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import { OutputTrackNameEditor } from '../src/common/editor/ui/timeline/OutputTrackNameEditor.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape']) test(`output name preserves native composing ${key}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const priorSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const root = createRoot(dom.container as unknown as Element);
	const commits: string[] = [];
	const closes: boolean[] = [];
	try {
		await act(async () => root.render(<ThemeProvider><OutputTrackNameEditor name="Send bus 1" label="Track name" blocked={false}
			onCommit={name => commits.push(name)} onClose={restoreFocus => closes.push(restoreFocus)} /></ThemeProvider>));
		const input = dom.one('input');
		const label = dom.one('.audio-editor-output-name-editor');
		await act(async () => { reactProps(input).onChange?.({ target: { value: 'とう' } }); });
		let prevented = false;
		await act(async () => { reactProps(label).onKeyDown?.({ key, nativeEvent: { isComposing: true },
			preventDefault: () => { prevented = true; } }); });
		assert.equal(prevented, false);
		assert.deepEqual(commits, []);
		assert.deepEqual(closes, []);
		assert.equal(input.ownerDocument.activeElement, input);
		await act(async () => { reactProps(input).onChange?.({ target: { value: '東京の送信' } }); });
		await act(async () => { reactProps(label).onKeyDown?.({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault() {} }); });
		assert.deepEqual(commits, ['東京の送信']);
		assert.deepEqual(closes, [true]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorSelect) Object.defineProperty(ReactTestElement.prototype, 'select', priorSelect); else Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		dom.restore();
	}
});
