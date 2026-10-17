/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { normalizePlayAtSpeedRate } from '../src/common/editor/engine/buffer-math.ts';
import { VarispeedControl } from '../vendor/audacity-design-system/components/src/VarispeedControl/VarispeedControl.tsx';

test('upstream speed control is opt-in even for preferences that enabled the retired speed button', () => {
	for (const workspace of ['classic', 'music', 'modern', 'audacity', 'video-editor']) {
		const preferences = createAudioEditorPreferencesV1({ workspace: { activeId: workspace, toolbarButtons: { 'play-at-speed': true } } });
		assert.equal(preferences.workspace.toolbarButtons.varispeed, false);
	}
});

test('the transport accepts the upstream 1–300 percent range and rejects invalid rates', () => {
	assert.equal(normalizePlayAtSpeedRate(0.01), 0.01);
	assert.equal(normalizePlayAtSpeedRate(3), 3);
	for (const rate of [0, 0.009, 3.01, NaN, Infinity]) assert.throws(() => normalizePlayAtSpeedRate(rate), RangeError);
});

test('speed readout steps without drag snapping and the slider resets to normal on double click', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const changes: number[] = [];
	try {
		await act(async () => root.render(<VarispeedControl speed={0.9} enabled onChange={value => changes.push(value)} onDial={value => changes.push(value)} />));
		const readout = reactProps(dom.one('[data-varispeed-display]')) as unknown as { onKeyDown(event: unknown): void };
		const key = (key: string, shiftKey = false) => ({ key, shiftKey, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} });
		await act(async () => readout.onKeyDown(key('ArrowUp', true)));
		assert.deepEqual(changes, [0.91]);
		await act(async () => readout.onKeyDown(key('ArrowDown')));
		assert.deepEqual(changes, [0.91, 0.8]);
		const slider = reactProps(dom.one('[data-varispeed-track]')) as unknown as { onDoubleClick(): void };
		await act(async () => slider.onDoubleClick());
		assert.equal(changes.at(-1), 1);
		assert.equal(dom.one('[data-varispeed-display]').textContent, '90%');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
});
