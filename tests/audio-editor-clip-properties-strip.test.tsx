/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ClipStrip } from '../vendor/audacity-design-system/components/src/ClipPropertiesPanel/clip-properties-controls.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('clip property strip previews a trim and publishes only release; Escape and cancellation leave history alone', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const changes: number[] = [];
	try {
		await act(async () => root.render(<ClipStrip clip={{ id: 'clip', name: 'Recording', trackName: 'Voice', start: 0,
			duration: 4, trimStart: 1, fullDuration: 10, stretchFactor: 1, pitchSemitones: 0, fadeIn: 0, fadeOut: 0 }}
			onTrimStartChange={value => changes.push(value)} />));
		const lane = dom.one('.clip-properties__strip-lane');
		lane.getBoundingClientRect = () => ({ width: 100 });
		const handle = dom.one('[data-clip-properties-handle="trim-start"]');
		const down = () => act(async () => reactProps(handle).onPointerDown({ button: 0, currentTarget: handle, clientX: 10, pointerId: 1, preventDefault() {} }));
		const move = () => act(async () => reactProps(handle).onPointerMove({ clientX: 30 }));
		await down(); await move();
		await act(async () => reactProps(handle).onPointerMove({ clientX: 40 }));
		assert.deepEqual(changes, []);
		await act(async () => reactProps(handle).onPointerUp());
		assert.deepEqual(changes, [4]);
		await down(); await move();
		await act(async () => reactProps(handle).onPointerCancel());
		assert.deepEqual(changes, [4]);
		await down(); await move();
		await act(async () => reactProps(handle).onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }));
		await act(async () => reactProps(handle).onPointerUp());
		assert.deepEqual(changes, [4]);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
