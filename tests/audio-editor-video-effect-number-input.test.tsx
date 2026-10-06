/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import VideoEffectNumberInput from '../src/common/editor/ui/inspector/VideoEffectNumberInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('video effect numeric drafts retain prefixes through live preview and cancel to the original value', async () => {
	const dom = installReactTestDom();
	const global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = global.IS_REACT_ACT_ENVIRONMENT;
	global.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let current = 0, commits = 0;
	const previews: number[] = [];
	const render = () => root.render(<VideoEffectNumberInput value={current} minimum={-1} maximum={1}
		step={0.01} label="Brightness" disabled={false} onBegin={() => undefined}
		onPreview={(value) => { current = Math.max(-1, Math.min(1, value)); previews.push(value); render(); }}
		onCommit={() => { commits += 1; }} onCancel={() => { current = 0; render(); }} />);
	try {
		await act(async () => render());
		const input = dom.one('input');
		await act(async () => reactProps(input).onFocus());
		for (const value of ['', '-', '-0', '-0.', '-0.5']) {
			await act(async () => reactProps(input).onChange({ currentTarget: { value, valueAsNumber: value.trim() ? Number(value) : Number.NaN } }));
			assert.equal(input.value, value);
		}
		assert.equal(current, -0.5);
		assert.equal(commits, 0);
		assert.deepEqual(previews, [-0, -0, -0.5]);
		await act(async () => reactProps(input).onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }));
		assert.equal(input.value, '0');
		assert.equal(commits, 0);
		assert.equal(current, 0);
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '-0.5', valueAsNumber: -0.5 } }));
		await act(async () => reactProps(input).onKeyDown({ key: 'Enter', preventDefault() {} }));
		assert.equal(commits, 1);
		assert.equal(current, -0.5);
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '2', valueAsNumber: 2 } }));
		await act(async () => reactProps(input).onKeyDown({ key: 'Enter', preventDefault() {} }));
		assert.equal(input.value, '1');
		assert.equal(current, 1);
	} finally {
		await act(async () => root.unmount());
		global.IS_REACT_ACT_ENVIRONMENT = prior;
		dom.restore();
	}
});
