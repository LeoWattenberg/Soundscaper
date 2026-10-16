/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ClipHeader } from '../vendor/audacity-design-system/components/src/ClipHeader/ClipHeader.tsx';
import { TrackNew } from '../vendor/audacity-design-system/components/src/Track/TrackNew.tsx';
import { ThemeProvider } from '../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape']) test(`clip rename releases native composing ${key}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const priorSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const root = createRoot(dom.container as unknown as Element);
	const commits: string[] = [];
	let finished = 0;
	try {
		await act(async () => root.render(<div data-clip-id="recording" role="group" tabIndex={0}>
			<ClipHeader name="Original" renameRequestId={1} onRename={name => commits.push(name)}
				onRenameFinished={() => { finished += 1; }} /></div>));
		const input = dom.one('input');
		input.focus();
		input.value = 'とう';
		let prevented = false;
		let stopped = false;
		await act(async () => { reactProps(input).onKeyDown?.({ key, currentTarget: input, nativeEvent: { isComposing: true },
			preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } }); });
		assert.equal(prevented, false);
		assert.equal(stopped, true);
		assert.equal(dom.find('input'), input);
		assert.equal(input.ownerDocument.activeElement, input);
		assert.deepEqual(commits, []);
		assert.equal(finished, 0);
		input.value = '東京の録音';
		await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', currentTarget: input,
			nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} }); });
		assert.deepEqual(commits, ['東京の録音']);
		assert.equal(dom.find('input'), null);
		assert.equal(finished, 1);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorSelect) Object.defineProperty(ReactTestElement.prototype, 'select', priorSelect); else Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		dom.restore();
	}
});

test('clip rename composition retains its native input inside the actual track wrapper', async () => {
	const dom = installReactTestDom();
	Object.defineProperty(window, 'getComputedStyle', { configurable: true, value: () => ({ display: 'block', visibility: 'visible' }) });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const priorSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const root = createRoot(dom.container as unknown as Element);
	let selections = 0;
	const commits: string[] = [];
	try {
		await act(async () => root.render(<ThemeProvider><TrackNew
			clips={[{ id: 'recording', name: 'Original', start: 0, duration: 1, selected: true, waveform: [] }]}
			trackIndex={0} width={800} onClipClick={() => { selections += 1; }}
			onClipRename={(_id, name) => commits.push(name)} /></ThemeProvider>));
		const clip = dom.one('[data-clip-id="recording"]');
		await act(async () => { reactProps(clip).onKeyDown?.({ key: 'F2', currentTarget: clip,
			preventDefault() {}, stopPropagation() {} }); });
		const input = dom.one('input');
		input.focus();
		input.value = 'とう';
		let prevented = false;
		let stopped = false;
		const event = { key: 'Enter', target: input, currentTarget: input, nativeEvent: { isComposing: true },
			preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } };
		await act(async () => {
			reactProps(input).onKeyDown?.(event);
			if (!stopped) reactProps(clip).onKeyDown?.({ ...event, currentTarget: clip });
		});
		assert.equal(prevented, false);
		assert.equal(selections, 0);
		assert.equal(dom.find('input'), input);
		assert.equal(input.ownerDocument.activeElement, input);
		assert.equal(commits.length, 0);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorSelect) Object.defineProperty(ReactTestElement.prototype, 'select', priorSelect); else Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		dom.restore();
	}
});
