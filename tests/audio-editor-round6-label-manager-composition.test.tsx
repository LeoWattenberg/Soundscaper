/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { LabelManagerRow } from '../src/common/editor/ui/workspace/LabelManagerRows.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape'] as const) test(`Manage labels releases composing ${key} without committing its unfinished title`, async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commits: unknown[] = [];
	try {
		await act(async () => { root.render(<LabelManagerRow label={{ id: 'label', trackId: 'track', trackName: 'Labels',
			title: 'Original', startFrame: 0, endFrame: 0 }} sampleRate={48000} copy={ENGLISH_COPY}
			controller={{ actions: { labels: { update: (...args: unknown[]) => { commits.push(args); } } } }}
			disabled={false} run={(operation: () => unknown) => operation()} />); });
		const input = dom.container.querySelectorAll('input').find(field => field.getAttribute('aria-label')?.startsWith('Label title:'));
		assert.ok(input);
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
		assert.equal(consumed, false);
		assert.equal(input.ownerDocument.activeElement, input);
		assert.equal(input.value, 'とう');
		assert.equal(commits.length, 0);
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: '東京の録音' } }); });
		await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', currentTarget: input,
			nativeEvent: { isComposing: false }, preventDefault: () => undefined, stopPropagation: () => undefined }); });
		assert.deepEqual(commits, [['track', 'label', { title: '東京の録音' }]]);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
